import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { BubbleAggregator } from '../src/bubble-aggregator.ts'
import type { BubbleView } from '../src/bubble-types.ts'
import { harness, peered } from './harness.ts'
const view = (): BubbleView => ({ scope: { gatewayKey: 'test', gatewayId: 'main' }, topics: [], workItems: [], gateway: null, edges: [], merges: [], health: { catalog: 'unknown', router: 'unknown' } })
const query = (aggregator: BubbleAggregator) => {
  const read = aggregator.read({ gatewayId: 'main' }); if (read.kind !== 'update') throw new Error('missing head')
  return { gatewayId: 'main', epoch: read.snapshot.cursor.epoch, since: read.snapshot.cursor.version, after: read.snapshot.cursor.seq, waitMs: 25000 }
}
const change = (aggregator: BubbleAggregator) => aggregator.publish([{ type: 'work.changed', workItemId: 'work', executionId: 'run', phase: 'running' }], 'main')

test('unchanged polls wait and multiple clients wake with the same coherent cut', async () => {
  const aggregator = new BubbleAggregator('test', view, () => ['main'])
  try {
    const q = query(aggregator), first = aggregator.poll(q), second = aggregator.poll(q)
    assert.equal(aggregator.pendingRequests, 2)
    change(aggregator)
    const [a, b] = await Promise.all([first, second])
    assert.equal(a.kind, 'update'); assert.equal(b.kind, 'update')
    if (a.kind === 'update' && b.kind === 'update') assert.deepEqual(a.snapshot.cursor, b.snapshot.cursor)
    assert.equal(aggregator.pendingRequests, 0)
  } finally { aggregator.close() }
})

test('timeout, caller abort, waiter limit and lifetime cancellation release resources', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const aggregator = new BubbleAggregator('test', view, () => ['main'], { maxWaiters: 1 })
  try {
    const q = query(aggregator), pending = aggregator.poll(q)
    await assert.rejects(aggregator.poll(q), /TOO_MANY_WAITERS/)
    t.mock.timers.tick(25000)
    assert.equal((await pending).kind, 'unchanged'); assert.equal(aggregator.pendingRequests, 0)
    const abort = new AbortController(), cancelled = aggregator.poll(q, abort.signal)
    abort.abort(); await assert.rejects(cancelled, /REQUEST_ABORTED/)
    assert.equal(aggregator.pendingRequests, 0)
    const closed = aggregator.poll(q); aggregator.close()
    await assert.rejects(closed, /BUBBLES_CLOSED/)
    assert.equal(aggregator.pendingRequests, 0)
    await assert.rejects(aggregator.poll(q), /BUBBLES_CLOSED/)
  } finally { aggregator.close(); t.mock.timers.reset() }
})

for (const boundary of ['before', 'after']) test('registration recheck closes the ' + boundary + ' listener race', async () => {
  const aggregator = new BubbleAggregator('test', view, () => ['main'])
  try {
    const q = query(aggregator), subscribe = aggregator.subscribe.bind(aggregator)
    aggregator.subscribe = listener => {
      if (boundary === 'before') change(aggregator)
      const off = subscribe(listener)
      if (boundary === 'after') change(aggregator)
      return off
    }
    assert.equal((await aggregator.poll(q)).kind, 'update')
    assert.equal(aggregator.pendingRequests, 0)
  } finally { aggregator.close() }
})

test('plugin teardown releases requests before the database closes; unregister alone cannot do this', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-dispose-')), app = await harness(root)
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never), handler = peered(connection)
    await new Promise<void>(resolve => setImmediate(resolve))
    app.ctx.theone.store.rememberGateway('test-gateway', app.gateway.id)
    const initial = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id }); if (initial.kind !== 'update') throw new Error('missing head')
    const cursor = initial.snapshot.cursor, url = 'http://dsh.internal/api/theone/bubbles?' + new URLSearchParams({ gatewayId: app.gateway.id, epoch: cursor.epoch, since: String(cursor.version), after: String(cursor.seq), waitMs: '25000' })
    const aggregator = app.ctx.theone.bubbles
    const registered = Promise.withResolvers<void>(), poll = aggregator.poll.bind(aggregator)
    aggregator.poll = (query, signal) => {
      const result = poll(query, signal)
      registered.resolve()
      return result
    }
    const pending = handler.fetch(new Request(url))
    // Header initialization may precede registration; teardown still has to release a real waiter.
    await registered.promise
    assert.equal(aggregator.pendingRequests, 1)
    const close = app.ctx.theone.store.close.bind(app.ctx.theone.store)
    let pendingAtClose = -1
    app.ctx.theone.store.close = () => { pendingAtClose = aggregator.pendingRequests; close() }
    await app.close()
    assert.equal(pendingAtClose, 0)
    assert.equal((await pending).status, 503)
    assert.equal((await handler.fetch(new Request(url))).status, 404)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('unregistering a host route leaves its existing request alive until its signal is cancelled', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-unregister-')), app = await harness(root)
  const aggregator = new BubbleAggregator('test', view, () => ['main'])
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never), handler = peered(connection)
    const q = query(aggregator), abort = new AbortController()
    const unregister = connection.fetch.register({ path: '/api/bubble-probe', methods: ['GET'], requestBody: 'buffered',
      fetch: async request => { try { return Response.json(await aggregator.poll(q, request.signal)) } catch { return new Response(null, { status: 499 }) } } })
    const pending = handler.fetch(new Request('http://dsh.internal/api/bubble-probe', { signal: abort.signal }))
    assert.equal(aggregator.pendingRequests, 1)
    await unregister()
    assert.equal((await handler.fetch(new Request('http://dsh.internal/api/bubble-probe'))).status, 404)
    assert.equal(aggregator.pendingRequests, 1)
    abort.abort(); assert.equal((await pending).status, 499)
    assert.equal(aggregator.pendingRequests, 0)
  } finally { aggregator.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})
