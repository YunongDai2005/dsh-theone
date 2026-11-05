import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BubbleAggregator } from '../src/bubble-aggregator.ts'
import type { BubbleView } from '../src/bubble-types.ts'
const view = (gatewayId: string | null = 'main'): BubbleView => ({ scope: { gatewayKey: 'test', gatewayId }, topics: [], workItems: [], gateway: null, edges: [], merges: [], health: { catalog: 'unknown', router: 'unknown' } })

test('event rings reset expired and cross-scope cursors; reads return isolated consistent cuts', () => {
  const aggregator = new BubbleAggregator('test', id => view(id), () => ['main', 'other'], { capacity: 2 })
  try {
    const initial = aggregator.read({ gatewayId: 'main' })
    assert.equal(initial.kind, 'update'); if (initial.kind !== 'update') return
    const cursor = initial.snapshot.cursor
    aggregator.publish([{ type: 'work.changed', workItemId: 'w', executionId: 'e', phase: 'starting' }, { type: 'delivery.changed', workItemId: 'w', executionId: 'e', phase: 'selected' }], 'main')
    const batch = aggregator.read({ gatewayId: 'main', epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(batch.kind, 'update'); if (batch.kind !== 'update') return
    assert.equal(batch.events.length, 2)
    assert.equal(batch.events[0].version, batch.events[1].version)
    assert.equal(batch.events[1].seq, batch.events[0].seq + 1)
    const other = aggregator.read({ gatewayId: 'other', epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(other.kind === 'update' && other.resetReason, 'scope_changed')
    aggregator.publish([{ type: 'work.changed', workItemId: 'w', executionId: 'e', phase: 'running' }], 'main')
    const expired = aggregator.read({ gatewayId: 'main', epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(expired.kind === 'update' && expired.resetReason, 'events_expired')
    batch.events.length = 0
    assert.equal(aggregator.read({ gatewayId: 'main' }).kind, 'update')
    assert.notEqual(new BubbleAggregator('test', id => view(id), () => ['main']).read({ gatewayId: 'main' }).kind === 'unchanged', true)
  } finally { aggregator.close() }
})

test('restoring visibility keeps the existing topic identity instead of creating it twice', () => {
  let current = view()
  current.topics = [{ id: 'a', title: 'A' } as BubbleView['topics'][number]]
  const aggregator = new BubbleAggregator('test', () => current, () => ['main'])
  try {
    const initial = aggregator.read({ gatewayId: 'main' }); if (initial.kind !== 'update') throw new Error('missing initial')
    current = { ...current, topics: [] }; aggregator.publish()
    current = { ...current, topics: [{ id: 'a', title: 'A' } as BubbleView['topics'][number]] }; aggregator.publish()
    const result = aggregator.read({ gatewayId: 'main', epoch: initial.snapshot.cursor.epoch, since: initial.snapshot.cursor.version, after: initial.snapshot.cursor.seq })
    assert.equal(result.kind, 'update'); if (result.kind !== 'update') return
    assert.ok(result.events.some(e => e.type === 'topic.changed' && e.change === 'restored'))
    assert.equal(result.events.some(e => e.type === 'topic.changed' && e.change === 'created'), false)
  } finally { aggregator.close() }
})
