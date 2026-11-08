/**
 * Hosts the topic cluster under TheOne's sidebar card: keeps its box aligned under the card, makes room
 * for it, turns the user's gestures into TheOne's existing topic operations, and feeds it TheOne's state.
 * The box lives on document.body (DSH owns the sidebar's DOM), positioned under the card every frame.
 */
import { createFoam } from "./client-foam.js";
const LIVE = new Set(['routing', 'starting', 'running', 'recovering']);
/** One topic's phase from its work items: waiting on the user first, then answering, answered and not yet shown, queued, failed. */
function phaseOf(items) {
    if (items.some(item => item.phase === 'waiting_user' || item.waits?.length))
        return 'waiting';
    if (items.some(item => LIVE.has(item.phase)))
        return 'running';
    if (items.some(item => item.phase === 'succeeded' && (item.delivery.phase === 'waiting' || item.delivery.phase === 'selected')))
        return 'answered';
    if (items.some(item => item.phase === 'queued'))
        return 'queued';
    if (items.some(item => (item.phase === 'failed' || item.phase === 'interrupted') && item.delivery.phase !== 'shown'))
        return 'failed';
    return 'idle';
}
/**
 * The finer status behind a phase, for the topic's details: which of routing/starting/answering/recovering, whether it waits
 * on a question or an approval, and why it is queued. Only what the work items say; nothing is guessed.
 */
export function statusOf(items, phase) {
    if (phase === 'waiting') {
        const kinds = items.flatMap(item => item.waits ?? []).map(wait => wait.kind);
        return { status: kinds.includes('question') ? 'question' : kinds.includes('approval') ? 'approval' : 'waiting' };
    }
    if (phase === 'running') {
        const live = items.filter(item => LIVE.has(item.phase)).map(item => item.phase);
        return { status: live.includes('running') ? 'running' : live.includes('recovering') ? 'recovering' : live.includes('starting') ? 'starting' : 'routing' };
    }
    if (phase === 'queued') {
        const reason = items.find(item => item.phase === 'queued')?.queueReason;
        return reason ? { status: 'queued', queueReason: reason } : { status: 'queued' };
    }
    return { status: phase };
}
/** The cluster's model from TheOne's bubble snapshot. Weight: recency (half-life about three days) and the last 30 days' use. */
export function modelFromBubbles(snapshot) {
    const now = snapshot.serverTime;
    const byTopic = new Map();
    for (const item of snapshot.workItems)
        if (item.contextId)
            byTopic.set(item.contextId, [...byTopic.get(item.contextId) ?? [], item]);
    const topics = snapshot.topics.map(topic => {
        const items = byTopic.get(topic.id) ?? [];
        const phase = phaseOf(items);
        const last = topic.usage.lastUsedAt ?? topic.lastActivityAt;
        const recency = last ? Math.pow(.5, Math.max(0, now - last) / (3 * 86400000)) : 0;
        const weight = Math.min(1, .65 * recency + .35 * Math.min(1, topic.usage.recentCalls / 12));
        const live = items.find(item => LIVE.has(item.phase));
        const busy = phase !== 'idle';
        return { id: topic.id, title: topic.title, label: topic.label ?? undefined, phase, weight, current: topic.current, group: topic.groupId ?? undefined,
            aside: !busy && !topic.current && (topic.effectiveDone || topic.archived),
            oneOff: items.length > 0 && items.every(item => item.temporary?.kind === 'model_aside'),
            startedAt: live ? live.updatedAt : undefined, ...statusOf(items, phase),
            lastActive: Math.max(topic.lastActivityAt ?? 0, topic.usage.lastUsedAt ?? 0) || undefined };
    });
    const links = snapshot.edges.map(edge => ({ a: edge.a, b: edge.b, weight: edge.relation === 'kept_apart' ? -.3 : Math.max(0, Math.min(1, edge.strength)) }));
    // Merges waiting for TheOne to go quiet hold the two cells together by a neck.
    const pendingMerges = (snapshot.merges ?? []).filter(merge => merge.state === 'queued' || merge.state === 'executing').map(merge => ({ id: merge.sourceId, into: merge.targetId, state: merge.state, operationId: merge.operationId }));
    return { topics, links, pendingMerges, suggestions: suggestionsFromBubbles(snapshot) };
}
/**
 * Possible duplicates TheOne noticed and keeps for the user: pending, not past their time, both topics on the
 * cluster, and neither already in a merge. Each keeps both directions, TheOne's default (new into old) first.
 */
export function suggestionsFromBubbles(snapshot) {
    const shown = new Set(snapshot.topics.map(topic => topic.id));
    const merging = new Set((snapshot.merges ?? []).filter(merge => merge.state === 'queued' || merge.state === 'executing').flatMap(merge => [merge.sourceId, merge.targetId]));
    const out = [];
    for (const suggestion of snapshot.mergeSuggestions ?? []) {
        const [a, b] = suggestion.pair;
        if (suggestion.state !== 'pending' || suggestion.expiresAt <= snapshot.serverTime || a === b)
            continue;
        if (!shown.has(a) || !shown.has(b) || merging.has(a) || merging.has(b))
            continue;
        const directions = suggestion.directions.filter(d => (d.sourceId === a && d.targetId === b) || (d.sourceId === b && d.targetId === a))
            .map(d => ({ sourceId: d.sourceId, targetId: d.targetId }));
        if (directions.length)
            out.push({ id: suggestion.suggestionId, a, b, directions });
    }
    return out;
}
/** What each routing event looks like on the cluster. Hints and bookkeeping events play nothing. */
export function foamEventsFrom(events, snapshot) {
    const items = new Map(snapshot.workItems.map(item => [item.id, item]));
    const out = [];
    for (const event of events) {
        if (event.type === 'route.assigned') {
            if (event.created)
                out.push({ kind: 'create', to: event.contextId });
            else if (items.get(event.workItemId)?.source === 'steering')
                out.push({ kind: 'supplement', to: event.contextId });
            else
                out.push({ kind: 'route', to: event.contextId, alternates: event.alternateIds, messageId: event.messageIds[0] });
        }
        else if (event.type === 'route.blocked' && event.candidateIds.length > 1)
            out.push({ kind: 'clarify', candidates: event.candidateIds });
        else if (event.type === 'route.moved')
            out.push({ kind: 'correct', from: event.fromId, to: event.toId, messageId: event.messageId });
        else if (event.type === 'topic.merged')
            out.push({ kind: 'merged', id: event.sourceId, into: event.targetId });
        else if (event.type === 'topic.unmerged')
            out.push({ kind: 'unmerged', id: event.sourceId, into: event.targetId });
    }
    return settleFoamEvents(out, snapshot);
}
/**
 * One feed batch's animations checked against the state it ended in, so an older event never undoes a newer state: of the
 * merges and undos of one source only the last plays, and only if the snapshot agrees (a merge whose source it still lists,
 * merged then undone in the same batch, plays nothing; nor does an undo whose source is gone again).
 */
export function settleFoamEvents(events, snapshot) {
    const present = new Set(snapshot.topics.map(topic => topic.id)), last = new Map();
    events.forEach((event, i) => { if (event.kind === 'merged' || event.kind === 'unmerged')
        last.set(event.id, i); });
    return events.filter((event, i) => event.kind === 'merged' ? last.get(event.id) === i && !present.has(event.id)
        : event.kind === 'unmerged' ? last.get(event.id) === i && present.has(event.id) : true);
}
const TERMINAL = new Set(['succeeded', 'cancelled', 'expired', 'failed']);
/**
 * How queued merges ended, each exactly once: `seen` keeps every operation's last state, a finished one is never overwritten
 * by an older state read later (history replayed after a receipt), and only a merge last seen queued or executing reports its end.
 * Pass the batch's history first and its snapshot and receipts after.
 */
export function mergeOutcomes(seen, merges) {
    const out = [];
    for (const merge of merges) {
        const was = seen.get(merge.operationId);
        if (was && TERMINAL.has(was))
            continue;
        seen.set(merge.operationId, merge.state);
        if (was !== 'queued' && was !== 'executing')
            continue;
        if (merge.state === 'succeeded')
            out.push({ kind: 'merged', id: merge.sourceId, into: merge.targetId, undo: true });
        else if (TERMINAL.has(merge.state))
            out.push({ kind: 'mergeEnded', id: merge.sourceId, into: merge.targetId, failed: merge.state !== 'cancelled', ...merge.error ? { error: merge.error } : {} });
    }
    return out;
}
const post = async (path, body, signal) => {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal, cache: 'no-store' });
    return response.ok;
};
/** Until the cluster's own state endpoint is there, the topic directory gives topics, workspaces, relatedness and status. */
export function modelFromCatalog(snapshot) {
    const groupOf = new Map();
    for (const group of snapshot.groups)
        for (const id of group.contextIds)
            groupOf.set(id, group.id);
    const visible = snapshot.contexts.filter(context => context.hidden !== 'orphaned' && context.hidden !== 'excluded');
    const topics = visible.map(context => {
        const status = context.topicStatus;
        const phase = status === 'waiting' ? 'waiting' : 'idle';
        // The directory has no usage counts (and is ordered by random id), so the topic's status stands in for its weight.
        return { id: context.id, title: context.title, phase, group: groupOf.get(context.id),
            weight: status === 'active' ? .7 : status === 'dormant' ? .15 : .4,
            aside: status === 'done' || context.hidden === 'archived' };
    });
    const links = [];
    for (const [id, entry] of Object.entries(snapshot.linkage?.topics ?? {}))
        for (const other of entry.related)
            if (id < other.id)
                links.push({ a: id, b: other.id, weight: other.reasons.includes('manual') ? 1 : other.reasons.includes('learned') ? .5 : .3 });
    return { topics, links };
}
/**
 * Makes room under the card and lets the rows below follow like a wave: the layout moves at once, and each
 * row is drawn back to where the row above it is, on its own spring, so a change ripples down the sidebar
 * instead of shifting it in one block. Rows: the card's siblings in DSH's list, then the next block (the
 * workspace region, clipped at its own bottom so it never slides over the footer); the footer stays put.
 *
 * Rows are things people click, so they hold still while someone is using them: the pointer over them, a
 * press on them, focus inside them, or a menu opened from them. A change waits until they are free; the
 * cluster meanwhile is clipped at the room it has, so it never covers a row. With reduced motion the rows
 * simply sit where the layout puts them. The offset uses the CSS `translate` property, which adds to
 * whatever transform DSH gives a row, and only that property is removed afterwards.
 */
function createWave(button, clip) {
    const K = 210, C = 2 * .6 * Math.sqrt(K), SLACK = 4;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let base = 0, wanted = 0, height = 0, started = false, frame = 0, retry = 0, last = 0, clipped = false;
    let pointer;
    const pressed = new Set();
    const state = new Map();
    const region = () => { const next = button.parentElement?.nextElementSibling; return next instanceof HTMLElement && next.offsetHeight && next.nextElementSibling ? next : null; };
    const rows = () => {
        const list = [];
        for (let row = button.nextElementSibling; row; row = row.nextElementSibling)
            if (row instanceof HTMLElement && row.offsetHeight)
                list.push(row);
        const block = region();
        if (block)
            list.push(block);
        return list;
    };
    const track = (el, y) => {
        let s = state.get(el);
        if (!s)
            state.set(el, s = { y, v: 0 });
        return s;
    };
    const release = (el) => { el.style.removeProperty('translate'); el.style.removeProperty('clip-path'); state.delete(el); };
    /** Someone is using the rows: the pointer is over them, a press on them, focus inside them, or a menu opened from one. */
    const busy = (list = rows()) => {
        if (pressed.size)
            return true;
        if (list.some(el => el.matches('[aria-haspopup][aria-expanded="true"]') || el.querySelector('[aria-haspopup][aria-expanded="true"]')))
            return true;
        const active = document.activeElement;
        if (document.hasFocus() && active && active !== document.body && list.some(el => el.contains(active)))
            return true;
        if (!pointer)
            return false;
        return list.some(el => { const r = el.getBoundingClientRect(); return pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom; });
    };
    /** While the rows hold still, the cluster may not draw past the room it has; null lifts the limit. */
    const limit = (frozen) => { const room = frozen && height + 10 > base ? base - 10 : null; if (room === null && !clipped)
        return; clipped = room !== null; clip(room); };
    function step(now) {
        frame = 0;
        let dt = Math.min(.1, (now - last) / 1000 || 1 / 60);
        last = now;
        const list = rows();
        for (const el of [...state.keys()])
            if (!list.includes(el))
                release(el);
        if (busy(list)) {
            // Checked again shortly: a lost pointerleave or a node DSH replaced must not hold the rows forever.
            limit(true);
            clearTimeout(retry);
            retry = window.setTimeout(wake, 400);
            return;
        }
        limit(false);
        // Reduced motion: rows that waited (or were still moving) go straight to their place when they are free, no spring after.
        if (motion.matches) {
            for (const el of [...state.keys()])
                release(el);
            if (wanted !== base)
                apply(wanted, list, true);
            return;
        }
        if (wanted !== base) {
            apply(wanted, list);
            return;
        }
        while (dt > 0) {
            const h = Math.min(dt, 1 / 120);
            dt -= h;
            let above = base;
            for (const el of list) {
                const s = track(el, base);
                s.v += (K * (above - s.y) - C * s.v) * h;
                s.y += s.v * h;
                above = s.y;
            }
            hold(list);
        }
        if (draw(list))
            frame = requestAnimationFrame(step);
    }
    /**
     * Rows may stretch apart freely but bunch up only by DSH's own gap between rows, so text and the
     * places one clicks never overlap the row above or the cluster.
     */
    function hold(list) {
        let above = base, speed = 0;
        for (const el of list) {
            const s = state.get(el);
            if (!s)
                continue;
            if (s.y < above - SLACK) {
                s.y = above - SLACK;
                s.v = Math.max(s.v, speed);
            }
            above = s.y;
            speed = s.v;
        }
    }
    /** Each row drawn at its own spring's height while the layout already has it at `base`; true while any row still moves. */
    function draw(list) {
        let moving = false;
        const block = region();
        for (const el of list) {
            const s = state.get(el);
            if (!s)
                continue;
            if (Math.abs(s.y - base) < .1 && Math.abs(s.v) < .5) {
                release(el);
                continue;
            }
            moving = true;
            const d = s.y - base;
            el.style.translate = `0 ${d.toFixed(2)}px`;
            // The workspace region fills down to the footer: pushed down, its bottom is cut so it stays above it.
            if (el === block)
                el.style.clipPath = d > 0 ? `inset(0 0 ${d.toFixed(2)}px 0)` : '';
        }
        return moving;
    }
    /** Moves the layout to `next`; the rows keep their place on screen in this same frame and spring after it. */
    function apply(next, list = rows(), still = false) {
        const before = base;
        base = next;
        button.style.marginBottom = `${next}px`;
        if (still) {
            for (const el of list)
                release(el);
            return;
        }
        for (const el of list)
            track(el, before);
        hold(list);
        if (draw(list) && !frame) {
            last = performance.now();
            frame = requestAnimationFrame(step);
        }
    }
    function wake() { if (!frame && (wanted !== base || state.size || clipped)) {
        last = performance.now();
        frame = requestAnimationFrame(step);
    } }
    const forget = () => { pointer = undefined; pressed.clear(); wake(); };
    const move = (event) => { if (event.pointerType !== 'touch')
        pointer = { x: event.clientX, y: event.clientY }; wake(); };
    const down = (event) => { if (rows().some(el => el.contains(event.target)))
        pressed.add(event.pointerId); };
    const up = (event) => {
        if (!pressed.delete(event.pointerId) && event.pointerType !== 'touch')
            return;
        if (event.pointerType === 'touch')
            pointer = undefined;
        wake();
    };
    const visible = () => { if (document.visibilityState !== 'visible')
        forget(); };
    const settle = () => {
        // Reduced motion switched on while rows were moving: they go straight to their place.
        if (!motion.matches)
            return;
        const list = rows();
        // In use: they settle the moment they are free (see step).
        if (busy(list)) {
            wake();
            return;
        }
        for (const el of [...state.keys()])
            release(el);
        if (wanted !== base)
            apply(wanted, list, true);
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('lostpointercapture', up, true);
    document.documentElement.addEventListener('pointerleave', forget);
    document.addEventListener('focusout', wake);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('blur', forget);
    motion.addEventListener('change', settle);
    return {
        set(next) {
            height = next;
            const room = Math.round(next * 2) / 2 + 10;
            wanted = room;
            if (room === base)
                return;
            const list = rows();
            // In use: wait, whatever the motion setting (the cluster is cut at the room it has meanwhile).
            if (started && busy(list)) {
                limit(true);
                wake();
                return;
            }
            // The first placement and reduced motion: the rows simply sit where the layout puts them.
            if (!started || motion.matches) {
                started = true;
                apply(room, list, true);
                return;
            }
            apply(room, list);
        },
        destroy() {
            cancelAnimationFrame(frame);
            clearTimeout(retry);
            for (const el of [...state.keys()])
                release(el);
            clip(null);
            button.style.marginBottom = '';
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerdown', down, true);
            document.removeEventListener('pointerup', up, true);
            document.removeEventListener('pointercancel', up, true);
            document.removeEventListener('lostpointercapture', up, true);
            document.documentElement.removeEventListener('pointerleave', forget);
            document.removeEventListener('focusout', wake);
            document.removeEventListener('visibilitychange', visible);
            window.removeEventListener('blur', forget);
            motion.removeEventListener('change', settle);
        },
    };
}
export function mountFoamHost(options) {
    const { button, signal } = options;
    const host = document.createElement('div');
    host.setAttribute('translate', 'no');
    document.body.appendChild(host);
    // Clip against the rows below while they hold still. The upper overflow is for message trails and intentional drags;
    // createFoam keeps resting outlines and hit areas below the main card.
    const wave = createWave(button, room => { host.style.clipPath = room === null ? '' : `inset(-400px -80px ${Math.max(0, host.offsetHeight - room).toFixed(1)}px -80px)`; });
    const sessionOf = new Map();
    let latest;
    /** The work item a stop gesture means: the topic's running (or waiting) execution, or its queued input. */
    const workOf = (id, queued) => latest?.workItems.find(item => item.contextId === id && item.stop.allowed
        && (queued ? item.phase === 'queued' : LIVE.has(item.phase) || item.phase === 'waiting_user'));
    const stopWork = (id, queued) => {
        const item = workOf(id, queued);
        if (item)
            void act({ action: 'stop', workItemId: item.id });
        else
            options.openMainChat();
    };
    /** Sends a topic operation; resolves to whether TheOne did it, and asks for fresh state either way. */
    const act = (body) => post('/api/theone/topics', body, signal).catch(() => false).finally(refresh);
    let undoable = [], shown;
    const mergeStates = new Map();
    const actions = {
        mount: id => { void options.mount(id).finally(refresh); },
        merge: async (id, into) => {
            // Always "when idle": TheOne merges at once if it is free (200) or queues it (202) and the snapshot's pending merges keep the neck.
            // Each gesture is a new intent, so it gets its own request id; an old cancelled or expired one never replays.
            try {
                const response = await fetch('/api/theone/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, signal, cache: 'no-store',
                    body: JSON.stringify({ action: 'merge', id, into, whenIdle: true, requestId: `${id}>${into}:${Date.now().toString(36)}` }) });
                if (response.status === 200)
                    void readCatalog(false);
                return response.status === 200 ? 'merged' : response.status === 202 ? 'queued' : 'failed';
            }
            catch {
                return 'failed';
            }
            finally {
                refresh();
            }
        },
        cancelMerge: operationId => act({ action: 'cancelMerge', operationId }),
        unmerge: async (sourceId) => {
            const ok = await act({ action: 'unmerge', id: sourceId });
            if (ok)
                await readCatalog(false);
            return ok;
        },
        answerSuggestion: async (suggestionId, response, direction) => {
            // Each accept is a new intent with its own request id; "later" leaves the suggestion pending on TheOne's side.
            const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${suggestionId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            const pick = response === 'accept' && direction ? { sourceId: direction.sourceId, targetId: direction.targetId, requestId } : {};
            try {
                const res = await fetch('/api/theone/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, signal, cache: 'no-store',
                    body: JSON.stringify({ action: 'mergeSuggestion', suggestionId, response, ...pick }) });
                if (response !== 'accept')
                    return res.ok ? 'done' : 'failed';
                if (res.status === 200)
                    void readCatalog(false);
                return res.status === 200 ? 'merged' : res.status === 202 ? 'queued' : 'failed';
            }
            catch {
                return 'failed';
            }
            finally {
                refresh();
            }
        },
        attach: (id, sessionId) => act({ action: 'attach', id, sessionId }),
        putAside: id => act({ action: 'status', id, done: true }),
        open: id => {
            const session = sessionOf.get(id);
            if (session)
                options.openSession(session);
            else
                void readCatalog(false).then(() => { const found = sessionOf.get(id); if (found)
                    options.openSession(found); });
        },
        stop: id => stopWork(id, false),
        cancelQueued: id => stopWork(id, true),
        remove: () => options.openWorkspace(),
        showAnswer: () => options.openMainChat(),
        reroute: async (messageId, contextId) => {
            try {
                const response = await fetch('/api/theone/routes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId, contextId }), signal, cache: 'no-store' });
                refresh();
                return response.status;
            }
            catch {
                return 0;
            }
        },
        answer: () => options.openMainChat(),
        openWorkspace: options.openWorkspace,
        text: options.text,
    };
    const foam = createFoam({
        host, actions, rail: options.rail,
        mark: () => button.querySelector('.theone-symbol'),
        side: () => button.closest('[data-sidebar-collapsed]') ?? button.closest('nav')?.parentElement ?? null,
        place: () => {
            const r = button.getBoundingClientRect();
            if (!r.width || !button.isConnected) {
                host.style.visibility = 'hidden';
                return;
            }
            host.style.visibility = '';
            host.style.left = `${r.left}px`;
            host.style.top = `${r.bottom}px`;
            host.style.width = `${r.width}px`;
        },
        onHeight: height => wave.set(height),
        onPulse: amount => {
            const mark = button.querySelector('.theone-symbol');
            if (mark)
                mark.style.transform = amount > .002 ? `scale(${(1 + .12 * amount).toFixed(3)})` : '';
        },
    });
    const show = (model) => { shown = model; foam.update({ ...model, merges: undoable }); options.onTopics?.(model.topics.length); };
    // The topic directory: session ids for "open topic", and the whole feed when TheOne has no bubble endpoint (an older back end).
    let readingCatalog = false;
    async function readCatalog(feed) {
        if (readingCatalog || signal.aborted)
            return;
        readingCatalog = true;
        try {
            const response = await fetch('/api/theone/catalog', { signal, cache: 'no-store' });
            if (!response.ok)
                return;
            const snapshot = await response.json();
            for (const context of snapshot.contexts)
                sessionOf.set(context.id, context.sourceSessionIds[0] ?? context.workingSessionId);
            // Finished merges that can still be undone, for the merged cell's menu.
            undoable = (snapshot.merges ?? []).map(merge => ({ sourceId: merge.sourceId, targetId: merge.targetId, title: merge.title }));
            if (feed)
                show(modelFromCatalog(snapshot));
            else if (shown)
                show(shown);
        }
        catch { /* The next round tries again. */ }
        finally {
            readingCatalog = false;
        }
    }
    // The bubble feed: one request in flight, held open by TheOne until something changes; after a reset only the state is taken, no old animations replay.
    let cursor, legacy = false, wake, failures = 0;
    async function feed() {
        while (!signal.aborted && !legacy) {
            wake = new AbortController();
            const hidden = document.visibilityState !== 'visible';
            const query = cursor ? `?epoch=${encodeURIComponent(cursor.epoch)}&since=${cursor.version}&after=${cursor.seq}&waitMs=${hidden ? 0 : 25000}` : '?waitMs=0';
            try {
                const response = await fetch(`/api/theone/bubbles${query}`, { signal: AbortSignal.any([signal, wake.signal]), cache: 'no-store' });
                if (response.status === 404) {
                    legacy = true;
                    break;
                }
                if (!response.ok)
                    throw new Error(String(response.status));
                const body = await response.json();
                failures = 0;
                if (body.kind === 'update') {
                    latest = body.snapshot;
                    for (const topic of body.snapshot.topics)
                        if (topic.openSessionId)
                            sessionOf.set(topic.id, topic.openSessionId);
                    // History first, then the snapshot's merges and receipts: each queued merge's end is taken once, and a merge undone later in
                    // this same batch plays nothing (its source is in the snapshot again).
                    const ended = mergeOutcomes(mergeStates, [...body.events.flatMap(event => event.type === 'merge.changed' ? [event] : []), ...body.snapshot.merges ?? [], ...body.snapshot.mergeReceipts ?? []]);
                    if (ended.some(event => event.kind === 'merged'))
                        void readCatalog(false);
                    for (const event of settleFoamEvents(ended, body.snapshot))
                        foam.event(event);
                    show(modelFromBubbles(body.snapshot));
                    if (!body.reset)
                        for (const event of foamEventsFrom(body.events, body.snapshot))
                            foam.event(event);
                    cursor = body.snapshot.cursor;
                }
                else
                    cursor = body.cursor;
                if (hidden)
                    await pause(8000);
            }
            catch {
                if (signal.aborted)
                    break;
                if (wake.signal.aborted)
                    continue;
                failures++;
                await pause(Math.min(30000, 1000 * 2 ** Math.min(failures, 5)) * (.75 + Math.random() * .5));
            }
        }
        if (legacy && !signal.aborted) {
            void readCatalog(true);
            legacyTimer = window.setInterval(() => { if (document.visibilityState === 'visible')
                void readCatalog(true); }, 4000);
        }
    }
    const pause = (ms) => new Promise(resolve => { const timer = window.setTimeout(resolve, ms); wake?.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
    let legacyTimer = 0;
    /** After the user's own action, ask again at once instead of waiting out the held request. */
    function refresh() { if (legacy)
        void readCatalog(true);
    else
        wake?.abort(); }
    void readCatalog(false);
    void feed();
    const focus = () => refresh();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return {
        setRail: on => foam.setRail(on),
        refresh,
        destroy() {
            clearInterval(legacyTimer);
            wake?.abort();
            window.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', focus);
            foam.destroy();
            host.remove();
            wave.destroy();
            button.querySelector('.theone-symbol')?.style.removeProperty('transform');
        },
    };
}
