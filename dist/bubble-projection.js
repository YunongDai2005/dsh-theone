import { activityLabel, learnDormancy, topicStatus } from "./topic-memory.js";
/** One shared predicate for the displayed capability and the server's done guard. */
export function doneCapability(work) {
    if (work.some(item => ['routing', 'queued', 'starting', 'running', 'waiting_user', 'recovering', 'unknown'].includes(item.phase)))
        return { allowed: false, reason: 'topic_busy' };
    if (work.some(item => ['waiting', 'selected', 'showing'].includes(item.delivery.phase)))
        return { allowed: false, reason: 'pending_delivery' };
    return { allowed: true };
}
/** Synchronous, read-only and body-free. Never calls briefing, recovery, indexing, a Worker or a model. */
export function projectBubbles(store, input) {
    const now = input.now ?? Date.now(), scope = { ...input.scope };
    const contexts = store.contexts(), hidden = store.hiddenReasons(), privateIds = store.privateIds();
    const current = store.current(scope.gatewayKey) ?? null;
    const usage = new Map(store.contextUsage(scope.gatewayKey, now).map(row => [row.contextId, row]));
    const latest = store.latestTopicRuns(), declared = store.declaredTopics();
    const timeline = store.routeTimeline(scope.gatewayKey), dormancy = learnDormancy(timeline);
    const lastAt = new Map(timeline.map(row => [row.contextId, row.at]));
    const groups = new Map(store.groups().flatMap(group => group.contextIds.map(id => [id, group.id])));
    const workItems = structuredClone((input.workItems ?? []).filter(item => item.gatewayId === scope.gatewayId));
    // A disk record proves a past run, not a live Worker or a delivery acknowledgement.
    for (const run of latest.values()) {
        if (workItems.some(item => item.messageIds.includes(run.messageId)))
            continue;
        if (store.route(run.messageId)?.gatewayId !== scope.gatewayId)
            continue;
        workItems.push({ id: 'record:' + run.messageId, gatewayId: scope.gatewayId, primaryMessageId: run.messageId,
            messageIds: [run.messageId], batchId: null, source: 'unknown', contextId: run.contextId, executionId: null, lane: null,
            phase: run.outcome === 'running' ? 'recovering' : run.outcome === 'completed' ? 'succeeded' : run.outcome === 'moved' ? 'superseded' : run.outcome,
            ...(run.outcome !== 'running' ? { outcome: run.outcome } : {}), updatedAt: run.endedAt ?? run.startedAt,
            delivery: { phase: 'unknown', shownSteps: 0, committedSteps: 0, commit: null }, stop: { allowed: false, reason: 'unsupported' } });
    }
    const byTopic = new Map();
    for (const item of workItems)
        if (item.contextId)
            byTopic.set(item.contextId, [...byTopic.get(item.contextId) ?? [], item]);
    const topics = contexts.filter(context => {
        const reason = hidden.get(context.id);
        if (reason === 'orphaned' || reason === 'excluded')
            return false;
        return reason !== 'archived' || context.id === current || !(input.doneCapabilities?.get(context.id) ?? doneCapability(byTopic.get(context.id) ?? [])).allowed;
    }).map(context => {
        const ownWork = byTopic.get(context.id) ?? [], record = latest.get(context.id);
        const live = ownWork.find(item => item.executionId && item.primaryMessageId === record?.messageId);
        const effectiveRun = record && { ...record, ...(live?.outcome ? { outcome: live.outcome } : {}) };
        const lifecycle = topicStatus({ latest: effectiveRun, declaredDoneAt: declared.get(context.id)?.at,
            dormant: activityLabel(lastAt.get(context.id), dormancy.perTopic.get(context.id) ?? dormancy.global, now).dormant,
            asking: ownWork.some(item => item.phase === 'waiting_user') });
        const used = usage.get(context.id);
        const queueMerge = input.merges?.some(op => op.sourceId === context.id || op.targetId === context.id)
            ? { allowed: false, reason: 'topic_busy' } : { allowed: true };
        const idle = input.busy ? { allowed: false, reason: 'gateway_busy' } : { allowed: true };
        return { id: context.id, title: context.title, topicRevision: null, current: context.id === current, lifecycle,
            declaredDoneAt: declared.get(context.id)?.at ?? null, effectiveDone: lifecycle === 'done', archived: hidden.get(context.id) === 'archived',
            private: privateIds.has(context.id), groupId: groups.get(context.id) ?? null, project: null,
            usage: { completedCalls: used?.completedCalls ?? 0, recentCalls: used?.recentCalls ?? 0, lastUsedAt: used?.lastUsedAt ?? null },
            lastActivityAt: Math.max(lastAt.get(context.id) ?? 0, record?.startedAt ?? 0, ...ownWork.map(item => item.updatedAt)) || null,
            workItemIds: ownWork.map(item => item.id), capabilities: { mount: idle, mergeNow: queueMerge.allowed ? idle : queueMerge, delete: idle,
                declareDone: input.doneCapabilities?.get(context.id) ?? doneCapability(ownWork), queueMerge } };
    });
    const visible = new Set(topics.map(topic => topic.id));
    for (const item of workItems) {
        if (item.contextId && !visible.has(item.contextId)) {
            item.contextId = null;
            item.targetUnavailable = true;
            delete item.waits;
        }
        if (item.temporary?.returnContextId && !visible.has(item.temporary.returnContextId))
            item.temporary.returnContextId = null;
    }
    const gateway = input.gateway ? structuredClone(input.gateway) : null;
    if (gateway) {
        gateway.currentId = current && visible.has(current) ? current : null;
        for (const item of [...gateway.nextTurn, ...gateway.nextStep])
            if (item.contextId && !visible.has(item.contextId))
                item.contextId = null;
    }
    const edges = [];
    const links = new Map(store.links(undefined, now).map(link => [JSON.stringify([link.a, link.b]), link]));
    const origins = store.origins(), linkScope = input.linkScope ?? 'auto';
    const available = contexts.filter(context => visible.has(context.id));
    if (linkScope !== 'off')
        for (let i = 0; i < available.length; i++)
            for (let j = i + 1; j < available.length; j++) {
                const a = available[i], b = available[j], link = links.get(JSON.stringify([a.id, b.id]));
                if (link?.manual === -1) {
                    edges.push({ a: a.id, b: b.id, relation: 'kept_apart', strength: 1, manual: -1, reasons: ['manual'] });
                    continue;
                }
                // Undirected layout uses the union of allowed reference directions. A private reader may read a public source.
                if (privateIds.has(a.id) && privateIds.has(b.id))
                    continue;
                const reasons = [], sameGroup = groups.has(a.id) && groups.get(a.id) === groups.get(b.id);
                let score = 0;
                if (link?.manual === 1) {
                    reasons.push('manual');
                    score += 100;
                }
                if (sameGroup) {
                    reasons.push('workspace');
                    score += linkScope === 'workspace' ? 1 : 0.6;
                }
                if (linkScope === 'auto') {
                    if (origins.get(a.id) && origins.get(a.id) === origins.get(b.id)) {
                        reasons.push('project');
                        score += 0.4;
                    }
                    const entities = new Set(a.entities.map(term => term.toLowerCase()));
                    const shared = b.entities.filter(term => entities.has(term.toLowerCase())).length;
                    if (shared) {
                        reasons.push('entities');
                        score += Math.min(0.4, shared * 0.2);
                    }
                }
                if ((link?.weight ?? 0) > 0.05 && (linkScope === 'auto' || sameGroup)) {
                    reasons.push('learned');
                    score += link.weight;
                }
                if (score >= (linkScope === 'workspace' ? 1 : 0.6))
                    edges.push({ a: a.id, b: b.id, relation: 'related',
                        strength: Math.round(Math.min(1, score) * 20) / 20, manual: link?.manual ?? 0, reasons });
            }
    const selected = new Set();
    for (const topic of topics)
        for (const edge of edges.filter(edge => edge.a === topic.id || edge.b === topic.id)
            .sort((a, b) => b.strength - a.strength || a.a.localeCompare(b.a) || a.b.localeCompare(b.b)).slice(0, 4))
            selected.add(edge);
    return { scope, topics, workItems, gateway, edges: edges.filter(edge => selected.has(edge)).slice(0, 256), merges: structuredClone((input.merges ?? []).filter(op => visible.has(op.sourceId) && visible.has(op.targetId))),
        health: input.health ?? { catalog: 'unknown', router: 'unknown' } };
}
