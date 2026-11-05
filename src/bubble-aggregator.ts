import { createHash, randomUUID } from 'node:crypto'
import type { BubbleCursor, BubbleEvent, BubbleEventData, BubbleReadQuery, BubbleReadResponse, BubbleView } from './bubble-types.ts'
interface Head { view: BubbleView; encoded: string; cursor: BubbleCursor; events: BubbleEvent[]; floor: number; knownTopics: Set<string> }

/** Single synchronous publisher: snapshot and event watermark always describe the same committed cut. */
export class BubbleAggregator {
  private epoch = randomUUID()
  private readonly heads = new Map<string | null, Head>()
  private readonly listeners = new Set<() => void>()
  private readonly capacity: number
  private closed = false
  constructor(private readonly gatewayKey: string, private readonly project: (id: string | null) => BubbleView,
    private readonly gatewayIds: () => string[], options: { capacity?: number } = {}) {
    this.capacity = Math.max(1, options.capacity ?? 512)
    this.publish()
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  publish(events: BubbleEventData[] = [], gatewayId: string | null = null): void {
    if (this.closed) return
    let changed = false
    for (const id of [null, ...this.gatewayIds()]) {
      const view = this.project(id), encoded = JSON.stringify(view)
      let head = this.heads.get(id)
      if (!head) {
        const suffix = createHash('sha256').update(JSON.stringify([this.gatewayKey, id])).digest('hex').slice(0, 16)
        this.heads.set(id, head = { view, encoded, cursor: { epoch: this.epoch + ':' + suffix, version: 0, seq: 0 }, events: [], floor: 0, knownTopics: new Set(view.topics.map(topic => topic.id)) })
        changed = true
        continue
      }
      const batch = [...this.topicEvents(head.view, view, head.knownTopics), ...(gatewayId === null || gatewayId === id ? events : [])]
      if (head.encoded === encoded && !batch.length) continue
      if (head.cursor.version >= Number.MAX_SAFE_INTEGER - 1 || head.cursor.seq >= Number.MAX_SAFE_INTEGER - batch.length - 1) {
        this.epoch = randomUUID(); this.heads.clear(); this.publish(); return
      }
      const cursor = { ...head.cursor, version: head.cursor.version + 1 }
      const appended: BubbleEvent[] = batch.map(event => ({ ...structuredClone(event), version: cursor.version, seq: ++cursor.seq, at: Date.now(), gatewayId: id }))
      head.view = view; head.encoded = encoded; head.cursor = cursor
      head.events.push(...appended)
      if (head.events.length > this.capacity) {
        const removed = head.events.splice(0, head.events.length - this.capacity)
        head.floor = removed.at(-1)!.seq
      }
      changed = true
    }
    if (changed) for (const listener of this.listeners) listener()
  }
  read(query: BubbleReadQuery = {}): BubbleReadResponse {
    const id = query.gatewayId ?? this.gatewayIds().at(-1) ?? null
    const head = this.heads.get(id)
    if (!head) throw new Error('UNKNOWN_GATEWAY')
    let resetReason: Extract<BubbleReadResponse, { kind: 'update' }>['resetReason']
    if (!query.epoch || query.since === undefined || query.after === undefined) resetReason = 'initial'
    else if (query.gatewayKey !== undefined && query.gatewayKey !== this.gatewayKey) resetReason = 'scope_changed'
    else if (query.epoch !== head.cursor.epoch) resetReason = query.epoch.split(':')[0] === this.epoch ? 'scope_changed' : 'epoch_changed'
    else if (query.since > head.cursor.version || query.after > head.cursor.seq) resetReason = 'cursor_ahead'
    else if (query.after < head.floor) resetReason = 'events_expired'
    if (!resetReason && query.since === head.cursor.version && query.after === head.cursor.seq)
      return { kind: 'unchanged', scope: { ...head.view.scope }, cursor: { ...head.cursor }, serverTime: Date.now() }
    const visible = new Set(head.view.topics.map(topic => topic.id))
    const events = resetReason ? [] : head.events.filter(event => event.seq > query.after!).flatMap<BubbleEvent>(event => {
      if ('contextId' in event && !visible.has(event.contextId) || 'fromId' in event && (!visible.has(event.fromId) || !visible.has(event.toId)) ||
        'suggestedId' in event && !visible.has(event.suggestedId) || 'sourceId' in event && (!visible.has(event.sourceId) || !visible.has(event.targetId))) return []
      if (event.type === 'route.assigned') return [{ ...event, relatedProposedIds: event.relatedProposedIds.filter(id => visible.has(id)), alternateIds: event.alternateIds.filter(id => visible.has(id)),
        ...(event.temporary ? { temporary: { ...event.temporary, returnContextId: event.temporary.returnContextId && visible.has(event.temporary.returnContextId) ? event.temporary.returnContextId : null } } : {}) }]
      if (event.type === 'route.blocked') return [{ ...event, candidateIds: event.candidateIds.filter(id => visible.has(id)) }]
      return [event]
    })
    return structuredClone({ kind: 'update', reset: !!resetReason, ...(resetReason ? { resetReason } : {}),
      snapshot: { ...head.view, schemaVersion: 1, cursor: head.cursor, eventFloor: head.floor, serverTime: Date.now() }, events })
  }
  close(): void { this.closed = true; this.listeners.clear() }
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
