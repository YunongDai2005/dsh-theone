import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BubbleAggregator } from '../src/bubble-aggregator.ts'
import { ContextStore } from '../src/store.ts'
import { projectBubbles } from '../src/bubble-projection.ts'
import type { BubbleEventData, BubbleReadResponse, BubbleView } from '../src/bubble-types.ts'
import { harness } from './harness.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const view = (gatewayId: string | null): BubbleView => ({ scope: { gatewayKey: 'test', gatewayId }, topics: [],
  workItems: [], gateway: null, edges: [], merges: [], health: { catalog: 'unknown', router: 'unknown' } })
const deferred = { defer: true } as NonNullable<ConstructorParameters<typeof BubbleAggregator>[3]>
const update = (response: BubbleReadResponse) => {
  assert.equal(response.kind, 'update')
  if (response.kind !== 'update') throw new Error('expected update')
  return response
}
const cursor = (aggregator: BubbleAggregator, gatewayId: string) => {
  const { snapshot } = update(aggregator.read({ gatewayId }))
  return { gatewayId, epoch: snapshot.cursor.epoch, since: snapshot.cursor.version, after: snapshot.cursor.seq }
}
const event = (workItemId: string): BubbleEventData => ({ type: 'work.changed', workItemId, executionId: null, phase: 'running' })

test('one publication reads shared facts once even when thirty gateways are actively read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-shared-')), app = await harness(root, undefined, { historyCatalog: true })
  try {
    const service = app.ctx.theone, store = service.store
    for (let i = 0; i < 30; i++) store.rememberGateway('test-gateway', 'g' + i)
    for (let i = 0; i < 30; i++) service.bubbles.read({ gatewayId: 'g' + i })
    await new Promise<void>(resolve => setImmediate(resolve))
    const counts = new Map<string, number>()
    for (const name of ['contexts', 'hiddenReasons', 'privateIds', 'contextUsage', 'latestTopicRuns', 'declaredTopics',
      'routeTimeline', 'groups', 'mergeSuggestions', 'links', 'origins', 'current', 'sourceRanges'] as const) {
      const original = store[name].bind(store) as (...args: any[]) => any
      ;(store as any)[name] = (...args: any[]) => { counts.set(name, (counts.get(name) ?? 0) + 1); return original(...args) }
    }
    const status = service.catalog!.statusSnapshot.bind(service.catalog)
    service.catalog!.statusSnapshot = () => { counts.set('catalog', (counts.get('catalog') ?? 0) + 1); return status() }
    service.bubbles.publish()
    await Promise.resolve()
    for (const name of ['contexts', 'hiddenReasons', 'privateIds', 'contextUsage', 'latestTopicRuns', 'declaredTopics',
      'routeTimeline', 'groups', 'mergeSuggestions', 'links', 'origins', 'current', 'catalog'])
      assert.equal(counts.get(name), 1, name + ' must be shared by all scopes')
    assert.equal(counts.get('sourceRanges'), store.contexts().length, 'source ranges are read once per topic')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('fifty store changes in one turn produce one projection per required scope', async () => {
  const store = new ContextStore(':memory:')
  store.seed(['a', 'b'].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' })))
  const projected: (string | null)[] = []
  const aggregator = new BubbleAggregator('test', id => {
    projected.push(id); return projectBubbles(store, { scope: { gatewayKey: 'test', gatewayId: id } })
  }, () => Array.from({ length: 30 }, (_, i) => 'g' + i), deferred)
  const off = store.subscribe(() => aggregator.publish())
  try {
    await Promise.resolve(); projected.length = 0
    for (let i = 0; i < 50; i++) store.setManualLink('a', 'b', i % 2 ? -1 : 1)
    await Promise.resolve()
    assert.equal(projected.length, 2, 'only null and the latest gateway need a projection')
    assert.deepEqual(projected, [null, 'g29'])
    const result = update(aggregator.read())
    assert.equal(result.snapshot.edges[0].relation, 'kept_apart')
  } finally { off(); aggregator.close(); store.close() }
})

test('deferred events keep call order, scoped attribution and one coherent version', async () => {
  const aggregator = new BubbleAggregator('test', view, () => ['old', 'main'], deferred)
  try {
    const main = cursor(aggregator, 'main'), old = cursor(aggregator, 'old')
    const first = event('first')
    aggregator.publish([first], 'main')
    aggregator.publish([event('both')])
    aggregator.publish([event('old-only')], 'old')
    aggregator.publish([event('last')], 'main')
    ;(first as { workItemId: string }).workItemId = 'mutated after publication'
    await Promise.resolve()
    for (const [query, ids] of [[main, ['first', 'both', 'last']], [old, ['both', 'old-only']]] as const) {
      const result = update(aggregator.read(query))
      assert.equal(result.reset, false)
      assert.deepEqual(result.events.map(e => 'workItemId' in e && e.workItemId), ids)
      assert.ok(result.events.every(e => e.gatewayId === query.gatewayId && e.version === result.snapshot.cursor.version))
      assert.deepEqual(result.events.map(e => e.seq), ids.map((_, i) => query.after + i + 1))
      assert.equal(result.snapshot.cursor.version, query.since + 1)
    }
  } finally { aggregator.close() }
})

test('read flushes pending work synchronously and the scheduled microtask does not republish', async () => {
  let calls = 0, ready = false
  const aggregator = new BubbleAggregator('test', id => { calls++; return { ...view(id), health: { catalog: ready ? 'ready' : 'unknown', router: 'rules' } } }, () => ['main'], deferred)
  try {
    const query = cursor(aggregator, 'main'); calls = 0
    ready = true; aggregator.publish([event('fresh')], 'main')
    const result = update(aggregator.read(query))
    assert.equal(result.snapshot.health.catalog, 'ready')
    assert.equal(result.events.length, 1)
    assert.equal(calls, 2)
    await Promise.resolve()
    assert.equal(calls, 2)
    assert.equal(aggregator.read({ ...query, since: result.snapshot.cursor.version, after: result.snapshot.cursor.seq }).kind, 'unchanged')
  } finally { aggregator.close() }
})

test('cold known gateways are lazy, continue normally, and get epoch_changed after idle eviction', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const projected: (string | null)[] = []
  const aggregator = new BubbleAggregator('test', id => { projected.push(id); return view(id) }, () => ['cold', 'main'], deferred)
  try {
    await Promise.resolve()
    assert.deepEqual(projected, [null, 'main'])
    const cold = cursor(aggregator, 'cold'), main = cursor(aggregator, 'main')
    assert.equal(aggregator.read(cold).kind, 'unchanged')
    aggregator.publish([event('cold-event')], 'cold')
    const changed = update(aggregator.read(cold))
    assert.equal(changed.reset, false)
    const latest = { ...cold, since: changed.snapshot.cursor.version, after: changed.snapshot.cursor.seq }
    t.mock.timers.tick(6 * 60 * 1000)
    projected.length = 0; aggregator.publish(); await Promise.resolve()
    assert.deepEqual(projected, [null, 'main'])
    assert.equal(aggregator.read(main).kind, 'unchanged', 'eviction must not reset the latest gateway')
    const rebuilt = update(aggregator.read(latest))
    assert.equal(rebuilt.resetReason, 'epoch_changed')
    assert.notEqual(rebuilt.snapshot.cursor.epoch, cold.epoch)
    assert.deepEqual(rebuilt.events, [])
    assert.throws(() => aggregator.read({ gatewayId: 'unknown' }), /UNKNOWN_GATEWAY/)
  } finally { aggregator.close(); t.mock.timers.reset() }
})

test('waiters pin their gateway past idle expiry and wake after the whole pending batch', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const aggregator = new BubbleAggregator('test', view, () => ['old', 'main'], deferred)
  try {
    const query = cursor(aggregator, 'old'), pending = aggregator.poll({ ...query, waitMs: 25000 })
    t.mock.timers.tick(6 * 60 * 1000)
    aggregator.publish([event('a')], 'old'); aggregator.publish([event('b')], 'old')
    const result = update(await pending)
    assert.equal(result.reset, false)
    assert.deepEqual(result.events.map(e => 'workItemId' in e && e.workItemId), ['a', 'b'])
    assert.equal(aggregator.pendingRequests, 0)
  } finally { aggregator.close(); t.mock.timers.reset() }
})

test('close discards queued publication without touching the projection again', async () => {
  let calls = 0
  const aggregator = new BubbleAggregator('test', id => { calls++; return view(id) }, () => ['main'], deferred)
  await Promise.resolve(); calls = 0
  aggregator.publish([event('discarded')]); aggregator.close(); await Promise.resolve()
  assert.equal(calls, 0)
  assert.throws(() => aggregator.read(), /BUBBLES_CLOSED/)
})

test('service keeps synchronous visibility transitions and direct bubbleView flushes queued events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-boundaries-')), app = await harness(root)
  try {
    const service = app.ctx.theone, store = service.store
    store.rememberGateway('test-gateway', app.gateway.id)
    const query = cursor(service.bubbles, app.gateway.id)
    store.replaceHidden([{ id: 'ctx_thesis', reason: 'excluded' }]); store.replaceHidden([])
    const result = update(service.bubbles.read(query))
    assert.deepEqual(result.events.flatMap(e => e.type === 'topic.changed' && e.contextId === 'ctx_thesis' ? [e.change] : []), ['removed', 'restored'])
    let notifications = 0
    const off = service.bubbles.subscribe(() => { notifications++ })
    try {
      service.bubbles.publish([event('direct-read')], app.gateway.id)
      service.bubbleView(app.gateway.id)
      assert.equal(notifications, 1)
    } finally { off() }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('queued work events stay before a later synchronous topic edit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-event-order-')), app = await harness(root)
  try {
    const service = app.ctx.theone
    service.store.rememberGateway('test-gateway', app.gateway.id)
    const query = cursor(service.bubbles, app.gateway.id)
    service.bubbles.publish([event('before-edit')], app.gateway.id)
    service.store.editTopic('ctx_thesis', { title: 'Edited thesis' })
    service.bubbles.publish([event('after-edit')], app.gateway.id)
    const result = update(service.bubbles.read(query))
    assert.deepEqual(result.events.map(e => e.type === 'topic.changed' ? e.change : 'workItemId' in e ? e.workItemId : e.type),
      ['before-edit', 'edited', 'after-edit'])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('the service coalesces fifty link writes and retains their final visible result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-store-burst-')), app = await harness(root)
  try {
    const service = app.ctx.theone, store = service.store
    store.rememberGateway('test-gateway', app.gateway.id)
    const query = cursor(service.bubbles, app.gateway.id), read = store.contexts.bind(store)
    let reads = 0
    store.contexts = () => { reads++; return read() }
    for (let i = 0; i < 50; i++) store.setManualLink('ctx_thesis', 'ctx_qwen_9070xt', i % 2 ? -1 : 1)
    const result = update(service.bubbles.read(query))
    assert.equal(reads, 1)
    assert.ok(result.snapshot.edges.some(e => e.relation === 'kept_apart'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a poll on the null scope stays there when the first gateway appears', async () => {
  const gateways: string[] = []
  const aggregator = new BubbleAggregator('test', view, () => gateways, deferred)
  try {
    const initial = update(aggregator.read()).snapshot.cursor
    const pending = aggregator.poll({ epoch: initial.epoch, since: initial.version, after: initial.seq, waitMs: 25000 })
    gateways.push('main')
    aggregator.publish([event('broadcast')])
    const result = update(await pending)
    assert.equal(result.snapshot.scope.gatewayId, null)
    assert.equal(result.reset, false)
    assert.equal(result.events[0].gatewayId, null)
  } finally { aggregator.close() }
})

test('failed preparation retains the pending events until a successful read', async () => {
  let fail = false
  const aggregator = new BubbleAggregator('test', id => { if (fail) throw new Error('projection failed'); return view(id) }, () => ['main'], deferred)
  try {
    const query = cursor(aggregator, 'main')
    fail = true; aggregator.publish([event('retained')], 'main')
    await Promise.resolve()
    assert.throws(() => aggregator.read(query), /projection failed/)
    fail = false
    const result = update(aggregator.read(query))
    assert.equal(result.reset, false)
    assert.deepEqual(result.events.map(e => 'workItemId' in e && e.workItemId), ['retained'])
  } finally { aggregator.close() }
})

test('a cold head survives listener rechecks while another scope has a waiter', async () => {
  const aggregator = new BubbleAggregator('test', view, () => ['cold', 'main'], deferred)
  const abort = new AbortController()
  try {
    const pending = aggregator.poll({ ...cursor(aggregator, 'main'), waitMs: 25000 }, abort.signal)
    const cancellation = assert.rejects(pending, /REQUEST_ABORTED/)
    const cold = cursor(aggregator, 'cold')
    assert.equal(aggregator.read(cold).kind, 'unchanged')
    assert.equal(aggregator.pendingRequests, 1)
    abort.abort(); await cancellation
  } finally { abort.abort(); aggregator.close() }
})

test('one deferred batch still enforces ring expiry and hides excluded event references', async () => {
  const store = new ContextStore(':memory:')
  store.seed([{ id: 'a', title: 'A', summary: '', entities: [], keywords: [], lastState: '' }])
  const aggregator = new BubbleAggregator('test', id => projectBubbles(store, { scope: { gatewayKey: 'test', gatewayId: id } }),
    () => ['main'], { ...deferred, capacity: 2, unavailableIds: () => store.unreachable() })
  try {
    const query = cursor(aggregator, 'main')
    aggregator.publish([event('one')]); aggregator.publish([event('two')]); aggregator.publish([event('three')])
    const expired = update(aggregator.read(query))
    assert.equal(expired.resetReason, 'events_expired')
    assert.equal(expired.snapshot.eventFloor, 1)
    const next = cursor(aggregator, 'main')
    aggregator.publish([{ type: 'route.hint', messageId: 'hint', suggestedId: 'a' }], 'main')
    store.replaceHidden([{ id: 'a', reason: 'excluded' }]); aggregator.publish()
    const hidden = update(aggregator.read(next))
    assert.equal(hidden.reset, false)
    assert.deepEqual(hidden.snapshot.topics, [])
    assert.deepEqual(hidden.events, [])
    assert.equal(hidden.snapshot.cursor.seq, next.after + 2)
  } finally { aggregator.close(); store.close() }
})

test('archived topics retain intermediate activity visibility transitions in one turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-archived-activity-')), app = await harness(root)
  try {
    const service = app.ctx.theone
    service.store.rememberGateway('test-gateway', app.gateway.id)
    service.store.replaceHidden([{ id: 'ctx_thesis', reason: 'archived' }])
    const query = cursor(service.bubbles, app.gateway.id)
    const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic queued input' }] })
    service.bubbleActivity.queue(app.gateway, input, 'topic_busy', 'ctx_thesis')
    service.bubbleActivity.discard(app.gateway.id, input.id)
    service.bubbleActivity.queue(app.gateway, input, 'topic_busy', 'ctx_thesis')
    const result = update(service.bubbles.read(query))
    assert.deepEqual(result.events.flatMap(e => e.type === 'topic.changed' && e.contextId === 'ctx_thesis' ? [e.change] : []),
      ['restored', 'removed', 'restored'])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('closing from a flush listener aborts the synchronous read with BUBBLES_CLOSED', () => {
  const aggregator = new BubbleAggregator('test', view, () => ['main'], deferred)
  try {
    const query = cursor(aggregator, 'main')
    aggregator.subscribe(() => aggregator.close())
    aggregator.publish([event('closing')])
    assert.throws(() => aggregator.read(query), /BUBBLES_CLOSED/)
  } finally { aggregator.close() }
})
