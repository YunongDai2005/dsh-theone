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
            startedAt: live ? live.updatedAt : undefined };
    });
    const links = snapshot.edges.map(edge => ({ a: edge.a, b: edge.b, weight: edge.relation === 'kept_apart' ? -.3 : Math.max(0, Math.min(1, edge.strength)) }));
    // Merges waiting for TheOne to go quiet hold the two cells together by a neck.
    const pendingMerges = (snapshot.merges ?? []).filter(merge => merge.state === 'queued' || merge.state === 'executing').map(merge => ({ id: merge.sourceId, into: merge.targetId }));
    return { topics, links, pendingMerges };
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
            out.push({ kind: 'correct', from: event.fromId, to: event.toId });
        else if (event.type === 'topic.merged')
            out.push({ kind: 'merged', id: event.sourceId, into: event.targetId });
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
 * workspace region); the footer stays put.
 *
 * Rows are things people click, so they hold still while someone is using them: with the pointer over
 * them, a button pressed on them or focus inside them, a change waits and is applied when they leave
 * (a large growth moves them at once, in one block, so the cluster never covers them). With reduced
 * motion the rows simply sit where the layout puts them. A row's own inline transform is put back after.
 */
function createWave(button) {
    const K = 210, C = 2 * .6 * Math.sqrt(K), SLACK = 8, URGENT = 24;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let base = 0, wanted = 0, started = false, frame = 0, last = 0, pressed = false;
    let pointer;
    const state = new Map();
    const rows = () => {
        const list = [];
        for (let row = button.nextElementSibling; row; row = row.nextElementSibling)
            if (row instanceof HTMLElement && row.offsetHeight)
                list.push(row);
        const next = button.parentElement?.nextElementSibling;
        if (next instanceof HTMLElement && next.offsetHeight && next.nextElementSibling)
            list.push(next);
        return list;
    };
    const track = (el, y) => {
        let s = state.get(el);
        if (!s)
            state.set(el, s = { y, v: 0, transform: el.style.transform, willChange: el.style.willChange });
        return s;
    };
    const release = (el) => {
        const s = state.get(el);
        if (!s)
            return;
        el.style.transform = s.transform;
        el.style.willChange = s.willChange;
        state.delete(el);
    };
    /** Someone is using the rows: the pointer is over them, pressing on them, or focus is inside them. */
    const busy = (list = rows()) => {
        if (pressed)
            return true;
        const active = document.activeElement;
        if (active && active !== document.body && list.some(el => el.contains(active)))
            return true;
        if (!pointer)
            return false;
        return list.some(el => { const r = el.getBoundingClientRect(); return pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom; });
    };
    function step(now) {
        frame = 0;
        let dt = Math.min(.1, (now - last) / 1000 || 1 / 60);
        last = now;
        const list = rows();
        for (const el of [...state.keys()])
            if (!list.includes(el))
                release(el);
        if (busy(list))
            return;
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
     * Rows may stretch apart freely but bunch up only a little: a row that lags too far behind the one above
     * is pushed along, so text never runs into the row above it or into the cluster.
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
        for (const el of list) {
            const s = state.get(el);
            if (!s)
                continue;
            if (Math.abs(s.y - base) < .1 && Math.abs(s.v) < .5) {
                release(el);
                continue;
            }
            moving = true;
            el.style.willChange = 'transform';
            el.style.transform = `translateY(${(s.y - base).toFixed(2)}px)`;
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
    const wake = () => { if (!frame && (wanted !== base || state.size)) {
        last = performance.now();
        frame = requestAnimationFrame(step);
    } };
    const move = (event) => { pointer = { x: event.clientX, y: event.clientY }; wake(); };
    const leave = () => { pointer = undefined; wake(); };
    const down = (event) => { if (rows().some(el => el.contains(event.target)))
        pressed = true; };
    const up = () => { if (pressed) {
        pressed = false;
        wake();
    } };
    const settle = () => {
        // Reduced motion switched on while rows were moving: they go straight to their place.
        if (!motion.matches)
            return;
        for (const el of [...state.keys()])
            release(el);
        if (wanted !== base)
            apply(wanted, rows(), true);
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.documentElement.addEventListener('pointerleave', leave);
    document.addEventListener('focusout', wake);
    window.addEventListener('blur', up);
    motion.addEventListener('change', settle);
    return {
        set(height) {
            const next = Math.round(height * 2) / 2 + 10;
            wanted = next;
            if (next === base)
                return;
            // The first placement and reduced motion: the rows simply sit where the layout puts them.
            if (!started || motion.matches) {
                started = true;
                apply(next, rows(), true);
                return;
            }
            const list = rows();
            if (busy(list)) {
                // Waits while the rows are in use, unless the cluster has grown enough to reach them: then one plain move.
                if (next - base > URGENT)
                    apply(next, list, true);
                else
                    wake();
                return;
            }
            apply(next, list);
        },
        destroy() {
            cancelAnimationFrame(frame);
            for (const el of [...state.keys()])
                release(el);
            button.style.marginBottom = '';
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerdown', down, true);
            document.removeEventListener('pointerup', up, true);
            document.removeEventListener('pointercancel', up, true);
            document.documentElement.removeEventListener('pointerleave', leave);
            document.removeEventListener('focusout', wake);
            window.removeEventListener('blur', up);
            motion.removeEventListener('change', settle);
        },
    };
}
export function mountFoamHost(options) {
    const { button, signal } = options;
    const host = document.createElement('div');
    host.setAttribute('translate', 'no');
    document.body.appendChild(host);
    const wave = createWave(button);
    const sessionOf = new Map();
    let latest;
    /** The work item a stop gesture means: the topic's running (or waiting) execution, or its queued input. */
    const workOf = (id, queued) => latest?.workItems.find(item => item.contextId === id && item.stop.allowed
        && (queued ? item.phase === 'queued' : LIVE.has(item.phase) || item.phase === 'waiting_user'));
    const stopWork = (id, queued) => {
        const item = workOf(id, queued);
        if (item)
            act({ action: 'stop', workItemId: item.id });
        else
            options.openMainChat();
    };
    const failed = () => { refresh(); };
    const act = (body) => { void post('/api/theone/topics', body, signal).then(ok => { if (!ok)
        failed();
    else
        refresh(); }).catch(failed); };
    const actions = {
        mount: id => { void options.mount(id).finally(refresh); },
        merge: (id, into, whenIdle) => {
            // 200: merged now, so the cells fuse. 202: queued until TheOne is idle; the snapshot's pending merges keep the neck. Anything else: the neck lets go.
            void fetch('/api/theone/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, signal, cache: 'no-store',
                body: JSON.stringify({ action: 'merge', id, into, ...(whenIdle ? { whenIdle: true, requestId: `${id}>${into}` } : {}) }) })
                .then(response => { if (response.status === 200)
                foam.event({ kind: 'merged', id, into }); refresh(); })
                .catch(failed);
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
    const show = (model) => { foam.update(model); options.onTopics?.(model.topics.length); };
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
            if (feed)
                show(modelFromCatalog(snapshot));
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
