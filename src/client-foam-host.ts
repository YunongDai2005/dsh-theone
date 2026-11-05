/**
 * Hosts the topic cluster under TheOne's sidebar card: keeps its box aligned under the card, makes room
 * for it, turns the user's gestures into TheOne's existing topic operations, and feeds it TheOne's state.
 * The box lives on document.body (DSH owns the sidebar's DOM), positioned under the card every frame.
 */
import { createFoam, type Foam, type FoamActions, type FoamEvent, type FoamModel, type FoamPhase, type FoamTextKey } from './client-foam.ts'
import type { CatalogSnapshot } from './catalog-types.ts'
import type { BubbleCursor, BubbleEvent, BubbleReadResponse, BubbleSnapshot, BubbleWorkItem } from './bubble-types.ts'

const LIVE: ReadonlySet<BubbleWorkItem['phase']> = new Set(['routing', 'starting', 'running', 'recovering'])

/** One topic's phase from its work items: waiting on the user first, then answering, answered and not yet shown, queued, failed. */
function phaseOf(items: BubbleWorkItem[]): FoamPhase {
  if (items.some(item => item.phase === 'waiting_user' || item.waits?.length)) return 'waiting'
  if (items.some(item => LIVE.has(item.phase))) return 'running'
  if (items.some(item => item.phase === 'succeeded' && (item.delivery.phase === 'waiting' || item.delivery.phase === 'selected'))) return 'answered'
  if (items.some(item => item.phase === 'queued')) return 'queued'
  if (items.some(item => (item.phase === 'failed' || item.phase === 'interrupted') && item.delivery.phase !== 'shown')) return 'failed'
  return 'idle'
}

/** The cluster's model from TheOne's bubble snapshot. Weight: recency (half-life about three days) and the last 30 days' use. */
export function modelFromBubbles(snapshot: BubbleSnapshot): FoamModel {
  const now = snapshot.serverTime
  const byTopic = new Map<string, BubbleWorkItem[]>()
  for (const item of snapshot.workItems) if (item.contextId) byTopic.set(item.contextId, [...byTopic.get(item.contextId) ?? [], item])
  const topics = snapshot.topics.map(topic => {
    const items = byTopic.get(topic.id) ?? []
    const phase = phaseOf(items)
    const last = topic.usage.lastUsedAt ?? topic.lastActivityAt
    const recency = last ? Math.pow(.5, Math.max(0, now - last) / (3 * 86400000)) : 0
    const weight = Math.min(1, .65 * recency + .35 * Math.min(1, topic.usage.recentCalls / 12))
    const live = items.find(item => LIVE.has(item.phase))
    const busy = phase !== 'idle'
    return { id: topic.id, title: topic.title, label: topic.label ?? undefined, phase, weight, current: topic.current, group: topic.groupId ?? undefined,
      aside: !busy && !topic.current && (topic.effectiveDone || topic.archived),
      oneOff: items.length > 0 && items.every(item => item.temporary?.kind === 'model_aside'),
      startedAt: live ? live.updatedAt : undefined }
  })
  const links = snapshot.edges.map(edge => ({ a: edge.a, b: edge.b, weight: edge.relation === 'kept_apart' ? -.3 : Math.max(0, Math.min(1, edge.strength)) }))
  // Merges waiting for TheOne to go quiet hold the two cells together by a neck.
  const pendingMerges = (snapshot.merges ?? []).filter(merge => merge.state === 'queued' || merge.state === 'executing').map(merge => ({ id: merge.sourceId, into: merge.targetId }))
  return { topics, links, pendingMerges }
}

/** What each routing event looks like on the cluster. Hints and bookkeeping events play nothing. */
export function foamEventsFrom(events: BubbleEvent[], snapshot: BubbleSnapshot): FoamEvent[] {
  const items = new Map(snapshot.workItems.map(item => [item.id, item]))
  const out: FoamEvent[] = []
  for (const event of events) {
    if (event.type === 'route.assigned') {
      if (event.created) out.push({ kind: 'create', to: event.contextId })
      else if (items.get(event.workItemId)?.source === 'steering') out.push({ kind: 'supplement', to: event.contextId })
      else out.push({ kind: 'route', to: event.contextId, alternates: event.alternateIds, messageId: event.messageIds[0] })
    } else if (event.type === 'route.blocked' && event.candidateIds.length > 1) out.push({ kind: 'clarify', candidates: event.candidateIds })
    else if (event.type === 'route.moved') out.push({ kind: 'correct', from: event.fromId, to: event.toId })
    else if (event.type === 'topic.merged') out.push({ kind: 'merged', id: event.sourceId, into: event.targetId })
  }
  return out
}

export interface FoamHostOptions {
  /** The sidebar card (DSH's panel row button that holds TheOne's entry). */
  button: HTMLElement
  signal: AbortSignal
  text(key: FoamTextKey, vars?: Record<string, string | number>): string
  /** Main chat continues with this topic. */
  mount(contextId: string): Promise<void>
  /** Open the topic's own chat. */
  openSession(sessionId: string): void
  openWorkspace(): void
  openMainChat(): void
  /** How many topics the cluster shows; with none, the Topic workspaces row stays as the way in. */
  onTopics?(count: number): void
  /** The sidebar is collapsed when the cluster mounts. */
  rail?: boolean
}

export interface FoamHost { setRail(on: boolean): void; refresh(): void; destroy(): void }

const post = async (path: string, body: unknown, signal: AbortSignal) => {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal, cache: 'no-store' })
  return response.ok
}

/** Until the cluster's own state endpoint is there, the topic directory gives topics, workspaces, relatedness and status. */
export function modelFromCatalog(snapshot: CatalogSnapshot): FoamModel {
  const groupOf = new Map<string, string>()
  for (const group of snapshot.groups) for (const id of group.contextIds) groupOf.set(id, group.id)
  const visible = snapshot.contexts.filter(context => context.hidden !== 'orphaned' && context.hidden !== 'excluded')
  const topics = visible.map(context => {
    const status = context.topicStatus
    const phase: FoamPhase = status === 'waiting' ? 'waiting' : 'idle'
    // The directory has no usage counts (and is ordered by random id), so the topic's status stands in for its weight.
    return { id: context.id, title: context.title, phase, group: groupOf.get(context.id),
      weight: status === 'active' ? .7 : status === 'dormant' ? .15 : .4,
      aside: status === 'done' || context.hidden === 'archived' }
  })
  const links: FoamModel['links'] = []
  for (const [id, entry] of Object.entries(snapshot.linkage?.topics ?? {}))
    for (const other of entry.related) if (id < other.id) links.push({ a: id, b: other.id, weight: other.reasons.includes('manual') ? 1 : other.reasons.includes('learned') ? .5 : .3 })
  return { topics, links }
}

export function mountFoamHost(options: FoamHostOptions): FoamHost {
  const { button, signal } = options
  const host = document.createElement('div')
  host.setAttribute('translate', 'no')
  document.body.appendChild(host)
  const sessionOf = new Map<string, string>()
  let latest: BubbleSnapshot | undefined
  /** The work item a stop gesture means: the topic's running (or waiting) execution, or its queued input. */
  const workOf = (id: string, queued: boolean) => latest?.workItems.find(item => item.contextId === id && item.stop.allowed
    && (queued ? item.phase === 'queued' : LIVE.has(item.phase) || item.phase === 'waiting_user'))
  const stopWork = (id: string, queued: boolean) => {
    const item = workOf(id, queued)
    if (item) act({ action: 'stop', workItemId: item.id }); else options.openMainChat()
  }
  const failed = () => { refresh() }
  const act = (body: Record<string, unknown>) => { void post('/api/theone/topics', body, signal).then(ok => { if (!ok) failed(); else refresh() }).catch(failed) }
  const actions: FoamActions = {
    mount: id => { void options.mount(id).finally(refresh) },
    merge: (id, into, whenIdle) => {
      // 200: merged now, so the cells fuse. 202: queued until TheOne is idle; the snapshot's pending merges keep the neck. Anything else: the neck lets go.
      void fetch('/api/theone/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, signal, cache: 'no-store',
        body: JSON.stringify({ action: 'merge', id, into, ...(whenIdle ? { whenIdle: true, requestId: `${id}>${into}` } : {}) }) })
        .then(response => { if (response.status === 200) foam.event({ kind: 'merged', id, into }); refresh() })
        .catch(failed)
    },
    attach: (id, sessionId) => act({ action: 'attach', id, sessionId }),
    putAside: id => act({ action: 'status', id, done: true }),
    open: id => {
      const session = sessionOf.get(id)
      if (session) options.openSession(session)
      else void readCatalog(false).then(() => { const found = sessionOf.get(id); if (found) options.openSession(found) })
    },
    stop: id => stopWork(id, false),
    cancelQueued: id => stopWork(id, true),
    remove: () => options.openWorkspace(),
    showAnswer: () => options.openMainChat(),
    reroute: async (messageId, contextId) => {
      try {
        const response = await fetch('/api/theone/routes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId, contextId }), signal, cache: 'no-store' })
        refresh()
        return response.status
      } catch { return 0 }
    },
    answer: () => options.openMainChat(),
    openWorkspace: options.openWorkspace,
    text: options.text,
  }
  const foam: Foam = createFoam({
    host, actions, rail: options.rail,
    mark: () => button.querySelector('.theone-symbol'),
    side: () => button.closest('[data-sidebar-collapsed]') ?? button.closest('nav')?.parentElement ?? null,
    place: () => {
      const r = button.getBoundingClientRect()
      if (!r.width || !button.isConnected) { host.style.visibility = 'hidden'; return }
      host.style.visibility = ''
      host.style.left = `${r.left}px`; host.style.top = `${r.bottom}px`; host.style.width = `${r.width}px`
    },
    onHeight: height => { button.style.marginBottom = `${Math.round(height) + 10}px` },
    onPulse: amount => {
      const mark = button.querySelector<SVGElement>('.theone-symbol')
      if (mark) mark.style.transform = amount > .002 ? `scale(${(1 + .12 * amount).toFixed(3)})` : ''
    },
  })

  const show = (model: FoamModel) => { foam.update(model); options.onTopics?.(model.topics.length) }

  // The topic directory: session ids for "open topic", and the whole feed when TheOne has no bubble endpoint (an older back end).
  let readingCatalog = false
  async function readCatalog(feed: boolean) {
    if (readingCatalog || signal.aborted) return
    readingCatalog = true
    try {
      const response = await fetch('/api/theone/catalog', { signal, cache: 'no-store' })
      if (!response.ok) return
      const snapshot = await response.json() as CatalogSnapshot
      for (const context of snapshot.contexts) sessionOf.set(context.id, context.sourceSessionIds[0] ?? context.workingSessionId)
      if (feed) show(modelFromCatalog(snapshot))
    } catch { /* The next round tries again. */ }
    finally { readingCatalog = false }
  }

  // The bubble feed: one request in flight, held open by TheOne until something changes; after a reset only the state is taken, no old animations replay.
  let cursor: BubbleCursor | undefined, legacy = false, wake: AbortController | undefined, failures = 0
  async function feed() {
    while (!signal.aborted && !legacy) {
      wake = new AbortController()
      const hidden = document.visibilityState !== 'visible'
      const query = cursor ? `?epoch=${encodeURIComponent(cursor.epoch)}&since=${cursor.version}&after=${cursor.seq}&waitMs=${hidden ? 0 : 25000}` : '?waitMs=0'
      try {
        const response = await fetch(`/api/theone/bubbles${query}`, { signal: AbortSignal.any([signal, wake.signal]), cache: 'no-store' })
        if (response.status === 404) { legacy = true; break }
        if (!response.ok) throw new Error(String(response.status))
        const body = await response.json() as BubbleReadResponse
        failures = 0
        if (body.kind === 'update') {
          latest = body.snapshot
          for (const topic of body.snapshot.topics) if (topic.openSessionId) sessionOf.set(topic.id, topic.openSessionId)
          show(modelFromBubbles(body.snapshot))
          if (!body.reset) for (const event of foamEventsFrom(body.events, body.snapshot)) foam.event(event)
          cursor = body.snapshot.cursor
        } else cursor = body.cursor
        if (hidden) await pause(8000)
      } catch {
        if (signal.aborted) break
        if (wake.signal.aborted) continue
        failures++
        await pause(Math.min(30000, 1000 * 2 ** Math.min(failures, 5)) * (.75 + Math.random() * .5))
      }
    }
    if (legacy && !signal.aborted) { void readCatalog(true); legacyTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void readCatalog(true) }, 4000) }
  }
  const pause = (ms: number) => new Promise<void>(resolve => { const timer = window.setTimeout(resolve, ms); wake?.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
  let legacyTimer = 0
  /** After the user's own action, ask again at once instead of waiting out the held request. */
  function refresh() { if (legacy) void readCatalog(true); else wake?.abort() }
  void readCatalog(false)
  void feed()
  const focus = () => refresh()
  window.addEventListener('focus', focus)
  document.addEventListener('visibilitychange', focus)

  return {
    setRail: on => foam.setRail(on),
    refresh,
    destroy() {
      clearInterval(legacyTimer); wake?.abort(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus)
      foam.destroy(); host.remove(); button.style.marginBottom = ''
      button.querySelector<SVGElement>('.theone-symbol')?.style.removeProperty('transform')
    },
  }
}
