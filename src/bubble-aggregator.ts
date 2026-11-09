import { setMaxListeners } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import type { BubbleCursor, BubbleEvent, BubbleEventData, BubbleReadQuery, BubbleReadResponse, BubbleView } from './bubble-types.ts'
interface Head {
  view: BubbleView; encoded: string; cursor: BubbleCursor; events: BubbleEvent[]; floor: number
  knownTopics: Set<string>; removedTopics: Set<string>; unavailable: Set<string>
  lastReadAt: number
}
export interface BubblePublication {
  project: (id: string | null) => BubbleView
  unavailableIds: ReadonlySet<string>; topicIds: readonly string[]
}
interface BubbleAggregatorOptions {
  capacity?: number; maxWaiters?: number
  unavailableIds?: () => ReadonlySet<string>
  topicIds?: () => readonly string[]
  prepare?: () => BubblePublication
  /** Legacy standalone publishers keep synchronous transition observation. The service opts in. */
  defer?: boolean
}

const HEAD_IDLE_MS = 5 * 60 * 1000
interface PendingPublication { events: BubbleEventData[]; gatewayId: string | null }

/** Flush commits all heads before notifying: snapshot and watermark describe the same cut. */
export class BubbleAggregator {
  private readonly heads = new Map<string | null, Head>()
  private readonly listeners = new Set<() => void>()
  private readonly capacity: number
  private closed = false
  private readonly lifetime = new AbortController()
  private readonly waiters = new Set<() => void>()
  private readonly maxWaiters: number
  private readonly waiterScopes = new Map<string | null, number>()
  private pending: PendingPublication[] = []
  private topicBoundary = 0
  private scheduled = false
  get pendingRequests(): number { return this.waiters.size }
  constructor(private readonly gatewayKey: string, private readonly project: (id: string | null) => BubbleView,
    private readonly gatewayIds: () => string[], private readonly options: BubbleAggregatorOptions = {}) {
    this.maxWaiters = Math.max(1, options.maxWaiters ?? 128)
    setMaxListeners(this.maxWaiters + 1, this.lifetime.signal)
    this.capacity = Math.max(1, options.capacity ?? 512)
    this.publish()
    this.flush()
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  publish(events: BubbleEventData[] = [], gatewayId: string | null = null, synchronous = false): void {
    if (this.closed) return
    // A mutation boundary follows any earlier activity events, rather than reordering its topic diff ahead of them.
    if (synchronous) this.topicBoundary = this.pending.length
    this.pending.push({ events: structuredClone(events), gatewayId })
    if (synchronous || !this.options.defer) { this.flush(); return }
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      // Keep a failed batch pending. A synchronous reader sees the error; the next publish retries.
      try { this.flush() } catch { /* A read-side observer cannot fail a committed write. */ }
    })
  }
  /** Also used at mutation boundaries where intermediate topic transitions must remain observable. */
  flush(requested?: string | null): void {
    if (this.closed) return
    if (!this.pending.length && (requested === undefined || this.heads.has(requested))) return
    const ids = this.gatewayIds(), latest = ids.at(-1) ?? null, now = Date.now()
    this.prune(latest, now)
    const refreshing = this.pending.length > 0
    const needed = refreshing ? new Set<string | null>([null, latest, ...this.heads.keys()]) : new Set<string | null>()
    if (requested !== undefined) needed.add(requested)
    const shared = this.options.prepare?.() ?? { project: this.project,
      unavailableIds: this.options.unavailableIds?.() ?? new Set<string>(), topicIds: this.options.topicIds?.() ?? [] }
    const unavailable = new Set(shared.unavailableIds), topicIds = shared.topicIds
    const unavailableKey = [...unavailable].sort()
    // Prepare every scope before modifying a head, so projection failures cannot expose a partial cut.
    const projections = [...needed].map(id => {
      const view = shared.project(id)
      return { id, view, encoded: JSON.stringify([view, unavailableKey]) }
    })
    const pending = this.pending, topicBoundary = this.topicBoundary
    this.pending = []; this.topicBoundary = 0
    let changed = false
    for (const { id, view, encoded } of projections) {
      let head = this.heads.get(id)
      if (!head) {
        const suffix = createHash('sha256').update(JSON.stringify([this.gatewayKey, id])).digest('hex').slice(0, 16)
        this.heads.set(id, head = { view, encoded, cursor: { epoch: randomUUID() + ':' + suffix, version: 0, seq: 0 }, events: [], floor: 0,
          knownTopics: new Set([...topicIds, ...view.topics.map(topic => topic.id)]), removedTopics: new Set(), unavailable,
          lastReadAt: id === requested ? now : -Infinity })
        changed = true
        continue
      }
      const topicEvents = this.topicEvents(head.view, view, head.knownTopics)
      for (const event of topicEvents) if (event.type === 'topic.changed' && event.change === 'removed' && !unavailable.has(event.contextId)) head.removedTopics.add(event.contextId)
      for (const hiddenId of unavailable) head.removedTopics.delete(hiddenId)
      for (const topic of view.topics) head.removedTopics.delete(topic.id)
      for (const topicId of topicIds) head.knownTopics.add(topicId)
      const scoped = (parts: PendingPublication[]) => parts.flatMap(part => part.gatewayId === null || part.gatewayId === id ? part.events : [])
      const batch = [...scoped(pending.slice(0, topicBoundary)), ...topicEvents, ...scoped(pending.slice(topicBoundary))]
      if (head.encoded === encoded && !batch.length) continue
      if (head.cursor.version >= Number.MAX_SAFE_INTEGER - 1 || head.cursor.seq >= Number.MAX_SAFE_INTEGER - batch.length - 1) {
        this.heads.clear(); this.pending = [{ events: [], gatewayId: null }]; this.flush(requested); return
      }
      const cursor = { ...head.cursor, version: head.cursor.version + 1 }
      const appended: BubbleEvent[] = batch.map(event => ({ ...structuredClone(event), version: cursor.version, seq: ++cursor.seq, at: Date.now(), gatewayId: id }))
      head.view = view; head.encoded = encoded; head.cursor = cursor; head.unavailable = unavailable
      head.events.push(...appended)
      if (head.events.length > this.capacity) {
        const removed = head.events.splice(0, head.events.length - this.capacity)
        head.floor = removed.at(-1)!.seq
      }
      changed = true
    }
    if (changed) for (const listener of this.listeners) listener()
  }
  private prune(latest: string | null, now: number): void {
    for (const [id, head] of this.heads) if (id !== null && id !== latest && !this.waiterScopes.has(id) && now - head.lastReadAt >= HEAD_IDLE_MS)
      this.heads.delete(id)
  }
  read(query: BubbleReadQuery = {}): BubbleReadResponse {
    return this.readScope(query)
  }
  private readScope(query: BubbleReadQuery, fixedId?: string | null): BubbleReadResponse {
    if (this.closed) throw new Error('BUBBLES_CLOSED')
    const ids = this.gatewayIds(), latest = ids.at(-1) ?? null
    const id = fixedId !== undefined ? fixedId : query.gatewayId ?? latest
    if (id !== null && !ids.includes(id)) throw new Error('UNKNOWN_GATEWAY')
    this.prune(latest, Date.now())
    const existing = this.heads.get(id)
    if (existing) existing.lastReadAt = Date.now()
    this.flush(id)
    if (this.closed) throw new Error('BUBBLES_CLOSED')
    const head = this.heads.get(id)!
    head.lastReadAt = Date.now()
    let resetReason: Extract<BubbleReadResponse, { kind: 'update' }>['resetReason']
    if (!query.epoch || query.since === undefined || query.after === undefined) resetReason = 'initial'
    else if (query.gatewayKey !== undefined && query.gatewayKey !== this.gatewayKey) resetReason = 'scope_changed'
    else if (query.epoch !== head.cursor.epoch) resetReason = [...this.heads.values()].some(other => other.cursor.epoch === query.epoch) ? 'scope_changed' : 'epoch_changed'
    else if (query.since > head.cursor.version || query.after > head.cursor.seq) resetReason = 'cursor_ahead'
    else if (query.after < head.floor) resetReason = 'events_expired'
    if (!resetReason && query.since === head.cursor.version && query.after === head.cursor.seq)
      return { kind: 'unchanged', scope: { ...head.view.scope }, cursor: { ...head.cursor }, serverTime: Date.now() }
    const visible = new Set(head.view.topics.map(topic => topic.id))
    const visibleOrRemoved = (contextId: string) => !head.unavailable.has(contextId) && (visible.has(contextId) || head.removedTopics.has(contextId))
    const events = resetReason ? [] : head.events.filter(event => event.seq > query.after!).flatMap<BubbleEvent>(event => {
      // A committed merge/removal references the old identity after it leaves the snapshot.
      // Exclusions still remove that identity from buffered events in the same published cut.
      const removed = event.type === 'topic.changed' && event.change === 'removed'
      if (event.type === 'mergeSuggestion.appeared' && (!event.suggestion.pair.every(id => visible.has(id)) ||
        !head.view.mergeSuggestions?.some(s => s.suggestionId === event.suggestion.suggestionId))) return []
      if ('contextId' in event && !(removed ? visibleOrRemoved(event.contextId) : visible.has(event.contextId)) ||
        'fromId' in event && (!visible.has(event.fromId) || !visible.has(event.toId)) ||
        'suggestedId' in event && !visible.has(event.suggestedId) ||
        'sourceId' in event && (!(event.type === 'topic.merged' || event.type === 'merge.changed' ? visibleOrRemoved(event.sourceId) : visible.has(event.sourceId)) || !visible.has(event.targetId))) return []
      if (event.type === 'route.assigned') return [{ ...event, relatedProposedIds: event.relatedProposedIds.filter(id => visible.has(id)), alternateIds: event.alternateIds.filter(id => visible.has(id)),
        ...(event.temporary ? { temporary: { ...event.temporary, returnContextId: event.temporary.returnContextId && visible.has(event.temporary.returnContextId) ? event.temporary.returnContextId : null } } : {}) }]
      if (event.type === 'route.blocked') return [{ ...event, candidateIds: event.candidateIds.filter(id => visible.has(id)) }]
      return [event]
    })
    return structuredClone({ kind: 'update', reset: !!resetReason, ...(resetReason ? { resetReason } : {}),
      snapshot: { ...head.view, schemaVersion: 1, cursor: head.cursor, eventFloor: head.floor, serverTime: Date.now() }, events })
  }
  async poll(query: BubbleReadQuery = {}, signal?: AbortSignal): Promise<BubbleReadResponse> {
    if (signal?.aborted) throw new Error('REQUEST_ABORTED')
    const first = this.read(query)
    if (first.kind === 'update' || !query.waitMs) return first
    if (this.pendingRequests >= this.maxWaiters) throw new Error('TOO_MANY_WAITERS')
    // Freeze the scope of this request even if another gateway becomes the default while it waits.
    const fixedId = first.scope.gatewayId
    return new Promise<BubbleReadResponse>((resolve, reject) => {
      let settled = false, timer: ReturnType<typeof setTimeout> | undefined, off = () => {}
      const finish = (result?: BubbleReadResponse, error?: Error) => {
        if (settled) return
        settled = true; clearTimeout(timer); off(); this.waiters.delete(closed)
        const remaining = this.waiterScopes.get(fixedId)! - 1
        if (remaining) this.waiterScopes.set(fixedId, remaining); else this.waiterScopes.delete(fixedId)
        signal?.removeEventListener('abort', aborted); this.lifetime.signal.removeEventListener('abort', closed)
        if (error) reject(error); else resolve(result!)
      }
      const check = () => {
        try { const latest = this.readScope(query, fixedId); if (latest.kind === 'update') finish(latest) }
        catch (error) { finish(undefined, error as Error) }
      }
      const aborted = () => finish(undefined, new Error('REQUEST_ABORTED'))
      const closed = () => finish(undefined, new Error('BUBBLES_CLOSED'))
      this.waiters.add(closed)
      this.waiterScopes.set(fixedId, (this.waiterScopes.get(fixedId) ?? 0) + 1)
      off = this.subscribe(check)
      // subscribe may synchronously publish; detach the returned listener even in that case.
      if (settled) { off(); return }
      signal?.addEventListener('abort', aborted, { once: true })
      this.lifetime.signal.addEventListener('abort', closed, { once: true })
      timer = setTimeout(() => {
        try { finish(this.readScope(query, fixedId)) } catch (error) { finish(undefined, error as Error) }
      }, Math.min(query.waitMs!, 25000))
      if (signal?.aborted) aborted()
      else if (this.closed) closed()
      else check()
    })
  }
  close(): void {
    if (this.closed) return
    this.closed = true; this.pending = []; this.lifetime.abort()
    for (const finish of this.waiters) finish()
    this.listeners.clear(); this.heads.clear()
  }
  private topicEvents(before: BubbleView, after: BubbleView, known: Set<string>): BubbleEventData[] {
    const old = new Map(before.topics.map(topic => [topic.id, topic])), next = new Map(after.topics.map(topic => [topic.id, topic]))
    const events: BubbleEventData[] = []
    for (const topic of after.topics) {
      const previous = old.get(topic.id)
      const changes: Extract<BubbleEventData, { type: 'topic.changed' }>['change'][] = []
      if (!previous) changes.push(known.has(topic.id) ? 'restored' : 'created')
      else {
        if (topic.current && !previous.current) changes.push('mounted')
        if (topic.declaredDoneAt !== previous.declaredDoneAt) changes.push(topic.declaredDoneAt === null ? 'reopened' : 'declared_done')
        else if (previous.effectiveDone && !topic.effectiveDone) changes.push('reopened')
        if (topic.archived !== previous.archived) changes.push(topic.archived ? 'archived' : 'restored')
        if (topic.title !== previous.title || topic.private !== previous.private || topic.groupId !== previous.groupId) changes.push('edited')
      }
      known.add(topic.id)
      for (const change of changes) events.push({ type: 'topic.changed', contextId: topic.id, change })
    }
    for (const topic of before.topics) if (!next.has(topic.id)) events.push({ type: 'topic.changed', contextId: topic.id, change: 'removed' })
    return events
  }
}

/** Reject malformed cursors instead of coercing negatives, floats, NaN or duplicate parameters. */
export function parseBubbleQuery(url: URL): BubbleReadQuery {
  const query: BubbleReadQuery = {}
  for (const key of ['gatewayId', 'gatewayKey', 'epoch', 'since', 'after', 'waitMs'] as const) {
    const values = url.searchParams.getAll(key)
    if (!values.length) continue
    if (values.length !== 1 || !values[0] || values[0].length > 256) throw new Error('INVALID_CURSOR')
    if (key === 'since' || key === 'after' || key === 'waitMs') {
      if (!/^\d+$/.test(values[0])) throw new Error('INVALID_CURSOR')
      const value = Number(values[0])
      if (!Number.isSafeInteger(value)) throw new Error('INVALID_CURSOR')
      query[key] = key === 'waitMs' ? Math.min(value, 25000) : value
    } else query[key] = values[0]
  }
  return query
}
