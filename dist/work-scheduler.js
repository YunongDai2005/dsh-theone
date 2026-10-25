export class WorkScheduler {
    store;
    handler;
    now;
    stopped = false;
    timer;
    pump;
    active;
    constructor(store, handler, now = Date.now) {
        this.store = store;
        this.handler = handler;
        this.now = now;
    }
    start() {
        if (this.timer || this.stopped)
            return;
        this.timer = setInterval(() => { void this.tick().catch(() => { }); }, 5000);
        this.timer.unref();
    }
    tick() {
        if (this.stopped)
            return Promise.resolve();
        return this.pump ??= this.drain().finally(() => { this.pump = undefined; });
    }
    async drain() {
        // A bounded batch yields to ordinary conversations even if new work keeps arriving.
        const visited = [];
        for (let i = 0; i < 32 && !this.stopped; i++) {
            const job = this.store.claim(this.now(), 90000, visited);
            if (!job)
                break;
            visited.push(job.id);
            const abort = new AbortController();
            this.active = { job, abort };
            const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]);
            const owns = () => !signal.aborted && !this.stopped && this.store.owns(job, this.now());
            let onAbort;
            const cancelled = new Promise((_resolve, reject) => {
                onAbort = () => reject(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
            });
            try {
                const outcome = await Promise.race([cancelled, this.handler(job, { signal, owns,
                        checkpoint: value => owns() && this.store.checkpoint(job, value, this.now()) })]);
                if (owns()) {
                    if (outcome.waiting)
                        this.store.wait(job, outcome.waiting, this.now());
                    else
                        this.store.finish(job, outcome.result, outcome.nextAt, outcome.notice, this.now());
                }
                else if (signal.aborted && !this.stopped && this.store.owns(job, this.now()))
                    this.store.fail(job, 'WORK_TIMEOUT', this.now());
            }
            catch (error) {
                if (!this.stopped && this.store.owns(job, this.now())) {
                    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
                    this.store.fail(job, signal.aborted ? 'WORK_TIMEOUT' : /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'WORK_FAILED', this.now());
                }
            }
            finally {
                signal.removeEventListener('abort', onAbort);
                if (this.stopped)
                    this.store.release(job, this.now());
                this.active = undefined;
            }
        }
    }
    control(id, action) {
        const changed = this.store.control(id, action, this.now());
        if (changed && this.active?.job.id === id)
            this.active.abort.abort();
        return changed;
    }
    async stop() {
        this.stopped = true;
        clearInterval(this.timer);
        this.active?.abort.abort();
        await this.pump;
    }
}
