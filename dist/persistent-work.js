import { WorkStore } from "./work-store.js";
import { WorkScheduler } from "./work-scheduler.js";
import { pullSource, readPullRequest, workError } from "./research.js";
export class PersistentWork {
    host;
    fetcher;
    now;
    store;
    scheduler;
    timer;
    notifying;
    stopped = false;
    constructor(path, host, fetcher = fetch, now = Date.now) {
        this.host = host;
        this.fetcher = fetcher;
        this.now = now;
        this.store = new WorkStore(path);
        this.scheduler = new WorkScheduler(this.store, (job, scope) => this.run(job, scope), now);
    }
    create(input, origin) {
        const source = pullSource(typeof input.url === 'string' ? input.url : '');
        const objective = typeof input.objective === 'string' ? input.objective.trim() : '';
        if (!objective || objective.length > 1000 || !origin.gatewayId || !origin.sessionId || !origin.key)
            throw workError('INVALID_WORK_REQUEST');
        const integer = (value, fallback, min, max) => {
            const n = value === undefined ? fallback : value;
            if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max)
                throw workError('INVALID_WORK_LIMIT');
            return n;
        };
        const now = this.now();
        const intervalMs = integer(input.intervalMinutes, 15, 5, 1440) * 60000;
        const maxChecks = integer(input.maxChecks, 96, 1, 1000);
        const deadline = integer(input.deadline, now + 86400000, now + 1, now + 30 * 86400000);
        if (input.completion !== undefined && !['closed', 'checks-passed'].includes(String(input.completion)))
            throw workError('INVALID_WORK_COMPLETION');
        const payload = { ...origin, objective, url: source.url, intervalMs, deadline, maxChecks,
            completion: input.completion === 'checks-passed' ? 'checks-passed' : 'closed' };
        if (!this.store.list().some(job => job.key === origin.key) && this.store.list().filter(job => job.kind === 'research' && !['completed', 'cancelled'].includes(job.state)).length >= 100)
            throw workError('WORK_TASK_LIMIT');
        return this.store.enqueue({ key: origin.key, kind: 'research', resource: `github:${source.owner.toLowerCase()}/${source.repo.toLowerCase()}`, payload }, now);
    }
    async run(job, scope) {
        if (job.kind !== 'research')
            return this.host.memory(job, scope);
        const task = job.payload;
        if (this.host.enabled && !this.host.enabled())
            return { waiting: 'TASKS_OFF' };
        if (this.host.available && !this.host.available(task))
            return { waiting: 'TASK_SOURCE_UNAVAILABLE' };
        if (this.now() >= task.deadline || job.runs > task.maxChecks)
            return { waiting: 'WORK_BUDGET_REACHED' };
        const snapshot = await readPullRequest(task.url, scope.signal, this.fetcher);
        const previous = job.result;
        const changed = previous?.snapshot?.fingerprint !== snapshot.fingerprint;
        const complete = snapshot.state === 'closed' || task.completion === 'checks-passed' && snapshot.status === 'passed' && !snapshot.partial;
        let summary = previous?.summary ?? '', nextStep = previous?.nextStep ?? '';
        if (changed) {
            summary = snapshot.state === 'closed' ? (snapshot.merged ? 'PR 已合并。' : 'PR 已关闭。') : snapshot.status === 'passed' ? '当前提交的已读取检查均已通过。' : snapshot.status === 'pending' ? '检查仍在进行，或检查信息不完整。' : 'CI 检查失败。';
            nextStep = '';
            if (snapshot.status === 'failed' && snapshot.state === 'open') {
                const analysis = await this.host.analyze(task, snapshot, scope.signal);
                scope.signal.throwIfAborted();
                if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis))
                    throw workError('INVALID_RESEARCH_RESULT');
                const value = analysis;
                if (typeof value.summary === 'string')
                    summary = value.summary.slice(0, 1800);
                if (typeof value.nextStep === 'string')
                    nextStep = value.nextStep.slice(0, 1200);
            }
        }
        const result = { snapshot, summary, nextStep, referenceOnly: true, checkedAt: this.now() };
        const actionable = complete || snapshot.status === 'failed' || snapshot.status === 'passed';
        return { result, ...complete ? {} : { nextAt: this.now() + task.intervalMs },
            ...(changed && actionable ? { notice: { fingerprint: snapshot.fingerprint,
                    text: `持续任务：${task.objective}\n${summary}${nextStep ? `\n建议：${nextStep}` : ''}\n${task.url}\n本次仅作只读检查，未修改代码或发送外部消息。` } } : {}) };
    }
    start() {
        if (this.timer || this.stopped)
            return;
        if (!this.host.enabled || this.host.enabled())
            for (const job of this.store.list())
                if (job.state === 'waiting' && job.error === 'TASKS_OFF')
                    this.store.control(job.id, 'resume', this.now());
        this.timer = setInterval(() => { void this.tick().catch(() => { }); }, 5000);
        this.timer.unref();
    }
    async tick() {
        if (this.stopped)
            return;
        await this.scheduler.tick();
        if (this.stopped)
            return;
        for (const job of this.store.list())
            if (job.kind === 'research' && ['failed', 'waiting'].includes(job.state) && job.error !== 'TASKS_OFF') {
                const reason = job.error === 'WORK_BUDGET_REACHED' ? '已达到时间或检查次数上限。' : job.error === 'TASK_SOURCE_UNAVAILABLE' ? '来源话题已不可用，任务已暂停。' : '连续检查失败，已停止自动重试。';
                this.store.attention(job, `持续任务：${job.payload.objective}\n${reason}请在「持续任务」查看处理。`, this.now());
            }
        await (this.notifying ??= this.deliver().finally(() => { this.notifying = undefined; }));
    }
    async deliver() {
        for (const notice of this.store.pendingNotices()) {
            if (this.stopped)
                return;
            const job = this.store.get(notice.jobId);
            if (job && await this.host.notify(notice, job).catch(() => false))
                this.store.delivered(notice.id);
        }
    }
    async close() {
        this.stopped = true;
        clearInterval(this.timer);
        await this.scheduler.stop();
        await this.notifying;
        this.store.close();
    }
}
