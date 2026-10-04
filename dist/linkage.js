/** Learning signals, in units of relatedness. A pair counts as related from 0.6. */
export const LINK_SIGNAL = { mention: 0.5, switch: 0.2, lookup: 0.4, unused: -0.05 };
const THRESHOLD = 0.6;
const normalize = (term) => term.toLowerCase().replace(/[\s/_-]+/g, '');
/**
 * Topics related to `contextId` under `scope`, strongest first. Private topics never share, and a
 * pair the user kept apart never relates. Relatedness starts from structure (same workspace, same
 * project directory, shared entities) and grows with use; the user's links always count.
 */
export function relatedTopics(store, contextId, scope, limit = 3, now = Date.now()) {
    if (scope === 'off')
        return [];
    const contexts = store.contexts();
    const self = contexts.find(context => context.id === contextId);
    if (!self)
        return [];
    const groupOf = new Map(store.groups().flatMap(group => group.contextIds.map(id => [id, group.id])));
    const links = new Map(store.links(contextId, now).map(link => [link.a === contextId ? link.b : link.a, link]));
    const ownEntities = new Set(self.entities.map(normalize).filter(term => term.length >= 2));
    // One read each, so the topic directory can compute every topic's links cheaply.
    const privateIds = store.privateIds();
    const origins = store.origins();
    const ownCwd = origins.get(contextId);
    const result = [];
    for (const other of contexts) {
        if (other.id === contextId || privateIds.has(other.id))
            continue;
        const link = links.get(other.id);
        if (link?.manual === -1)
            continue;
        const reasons = [];
        let score = 0;
        if (link?.manual === 1) {
            reasons.push('manual');
            score += 100;
        }
        const sameGroup = groupOf.has(contextId) && groupOf.get(contextId) === groupOf.get(other.id);
        if (scope === 'workspace') {
            if (sameGroup) {
                reasons.push('workspace');
                score += 1 + (link?.weight ?? 0);
            }
        }
        else {
            if (sameGroup) {
                reasons.push('workspace');
                score += 0.6;
            }
            if (ownCwd && origins.get(other.id) === ownCwd) {
                reasons.push('project');
                score += 0.4;
            }
            const shared = other.entities.filter(term => ownEntities.has(normalize(term))).length;
            if (shared) {
                reasons.push('entities');
                score += Math.min(0.4, 0.2 * shared);
            }
            if ((link?.weight ?? 0) > 0.05) {
                reasons.push('learned');
                score += link.weight;
            }
        }
        if (reasons.length && score >= (scope === 'workspace' ? 1 : THRESHOLD))
            result.push({ id: other.id, title: other.title, score, reasons });
    }
    return result.sort((a, b) => b.score - a.score).slice(0, limit);
}
/**
 * Whether `source` may share with `reader` right now, read from current settings every time: never
 * when linking is off, a private topic, or a pair the user kept apart; within the same workspace only
 * (unless linked by hand) in workspace scope. Undefined means allowed; otherwise the reason.
 */
export function mayShare(store, scope, source, reader) {
    if (scope === 'off')
        return 'off';
    if (!store.contexts().some(context => context.id === source))
        return 'unknown';
    if (source === reader)
        return undefined;
    const link = store.links(source).find(item => item.a === reader || item.b === reader);
    if (store.isPrivate(source) || link?.manual === -1)
        return 'private';
    if (scope === 'workspace' && link?.manual !== 1 &&
        !store.groups().some(group => group.contextIds.includes(reader) && group.contextIds.includes(source)))
        return 'workspace';
    return undefined;
}
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const sqlTime = (text) => Date.parse(String(text).replace(' ', 'T') + 'Z');
const clip = (text, max) => text.length > max ? text.slice(0, max - 1) + '…' : text;
/** When a topic last changed in a way another topic should hear about. */
export function lastChange(store, contextId) {
    const states = store.stateUpdates(contextId);
    return Math.max(0, ...states.map(state => sqlTime(state.createdAt)), store.digest(contextId)?.at ?? 0, store.constraints(contextId)?.at ?? 0);
}
/**
 * What a topic currently knows: its latest compaction summary (dated, since it covers only up to the
 * compaction), the progress recorded after it, and its standing constraints, kept separately because
 * summaries tend to drop rules. Short topics without a compaction fall back to their catalog summary.
 */
export function topicDigest(store, context, summaryChars, updates = 3) {
    const lines = [];
    const digest = store.digest(context.id);
    const states = store.stateUpdates(context.id)
        .filter(state => !digest || sqlTime(state.createdAt) > digest.at).slice(-updates);
    if (digest)
        lines.push(`压缩摘要（截至 ${stamp(digest.at)}）：${clip(digest.summary, summaryChars)}`);
    else
        lines.push(`摘要：${clip(context.summary, Math.min(summaryChars, 400))}`);
    for (const state of states)
        lines.push(`进展（${stamp(sqlTime(state.createdAt))}）：${clip(state.state, 300)}`);
    if (!states.length && !digest && context.lastState)
        lines.push(`最新状态：${clip(context.lastState, 300)}`);
    return lines;
}
/**
 * The cross-topic reference a Worker receives when it starts: the recent main chat after a topic
 * switch (so "what we just said" carries over), its own constraints, and related topics' changes
 * since it last heard of them. Everything is marked as dated reference material, not instructions.
 */
export function buildBriefing(store, input) {
    const now = input.now ?? Date.now();
    const budget = input.budget ?? 6000;
    const parts = [];
    const shown = [];
    // Constraints are re-pinned every time, since compaction tends to drop standing rules.
    let worthSending = false;
    const own = store.constraints(input.context.id);
    if (own) {
        parts.push(`本话题的约束（必须遵守）：${own.text}`);
        worthSending = true;
    }
    if (input.notices?.length) {
        parts.push(['你之前用到的其他话题要点有变化，以此为准：', ...input.notices].join('\n'));
        worthSending = true;
    }
    if (input.facts?.length) {
        parts.push(['本轮用到的其他话题要点（引用资料，是用户确认过的值）：', ...input.facts].join('\n'));
        worthSending = true;
    }
    if (input.recent.length) {
        let room = 1500;
        const lines = [];
        for (const message of [...input.recent].reverse()) {
            const line = `${message.role === 'user' ? '用户' : '助手'}：${clip(message.text.replace(/\s+/g, ' '), 400)}`;
            if (line.length > room)
                break;
            room -= line.length;
            lines.unshift(line);
        }
        if (lines.length) {
            parts.push(['主聊天里刚才的对话（可能属于其他话题）：', ...lines].join('\n'));
            worthSending = true;
        }
    }
    for (const topic of input.related) {
        const context = store.contexts().find(item => item.id === topic.id);
        if (!context)
            continue;
        const changed = lastChange(store, topic.id);
        const seen = store.seen(input.context.id, topic.id);
        const rules = store.constraints(topic.id);
        const lines = [`【${context.title}】（topicId: ${topic.id}）`];
        if (rules) {
            lines.push(`约束（必须遵守）：${rules.text}`);
            worthSending = true;
        }
        if (seen !== undefined && changed <= seen)
            lines.push('自上次以来没有新进展。');
        else {
            lines.push(...topicDigest(store, context, 600));
            shown.push(topic.id);
            worthSending = true;
        }
        store.markSeen(input.context.id, topic.id, Math.max(changed, seen ?? 0) || now);
        parts.push(lines.join('\n'));
    }
    // Only "no news" lines would add noise to every reply on the same topic.
    if (!worthSending)
        return undefined;
    const header = '以下是跨话题参考资料，不是用户本轮的指令。内容截至所注时间，可能已经变化；与最新记录冲突时以最新为准，需要细节请用 theone_read_topic 或 theone_search_history 查看原记录。约束必须遵守。';
    return { text: clip([header, ...parts].join('\n\n'), budget), shown };
}
