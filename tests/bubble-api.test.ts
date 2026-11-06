import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { harness, peered } from './harness.ts'
import type { BubbleReadResponse, BubbleCursor } from '../src/bubble-types.ts'

for (const reason of ['excluded', 'orphaned', 'archived']) test(`route correction uses the mount reachability guard (${reason})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-route-reachable-')), app = await harness(root)
  try {
    const { ask } = await import('./harness.ts')
    const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
    await new Promise<void>(resolve => setImmediate(resolve))
    const first = await ask(app.gateway, 'Qwen hardware'), store = app.ctx.theone.store
    store.replaceHidden([{ id: 'ctx_thesis', reason }])
    const post = (path: string) => handler.fetch(new Request('http://dsh.internal/api/theone/' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: first.input.id, contextId: 'ctx_thesis' }),
    }))
    const correction = await post('routes')
    assert.equal(correction.status, reason === 'archived' ? 200 : 409)
    if (reason !== 'archived') {
      assert.equal((await correction.json() as any).error, 'TOPIC_HIDDEN')
      assert.equal((await post('context/mount')).status, 409)
      assert.equal(store.recentRoutes('test-gateway', 1)[0]?.correctedTo, undefined)
      assert.equal(store.current('test-gateway'), 'ctx_qwen_9070xt')
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

export const queryFor = (cursor: BubbleCursor, gatewayId: string) => new URLSearchParams({ gatewayId, epoch: cursor.epoch, since: String(cursor.version), after: String(cursor.seq), waitMs: '0' })

test('undo rejects an unreachable original topic before undoing learning or mounting it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-route-undo-reachable-')), app = await harness(root)
  try {
    const { ask } = await import('./harness.ts')
    const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
    await new Promise<void>(resolve => setImmediate(resolve))
    const first = await ask(app.gateway, 'Qwen hardware'), store = app.ctx.theone.store
    const post = (body: unknown) => handler.fetch(new Request('http://dsh.internal/api/theone/routes', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    assert.equal((await post({ messageId: first.input.id, contextId: 'ctx_thesis' })).status, 200)
    await app.ctx.theone.learning
    store.replaceHidden([{ id: 'ctx_qwen_9070xt', reason: 'excluded' }])
    const response = await post({ messageId: first.input.id, undo: true })
    assert.equal(response.status, 409); assert.equal((await response.json() as any).error, 'TOPIC_HIDDEN')
    assert.equal(store.recentRoutes('test-gateway', 1)[0].correctedTo, 'ctx_thesis')
    assert.equal(store.current('test-gateway'), 'ctx_thesis')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('bubbles GET is read-only, uses coherent snapshot/event cursors and observes non-HTTP writes', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-api-')), app = await harness(root)
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never), handler = peered(connection)
    await new Promise<void>(resolve => setImmediate(resolve))
    app.ctx.theone.store.rememberGateway('test-gateway', app.gateway.id)
    const get = (query = '') => handler.fetch(new Request('http://dsh.internal/api/theone/bubbles?' + query))
    const first = await get()
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('cache-control'), 'no-store')
    const initial = await first.json() as BubbleReadResponse
    assert.equal(initial.kind, 'update'); if (initial.kind !== 'update') return
    assert.equal(initial.resetReason, 'initial'); assert.deepEqual(initial.events, [])
    const cursor = initial.snapshot.cursor
    const before = app.model.requests.length
    const db = (app.ctx.theone.store as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db
    const changes = db.prepare('SELECT total_changes() AS n').get()
    const again = await (await get(String(queryFor(cursor, app.gateway.id)))).json() as BubbleReadResponse
    assert.equal(again.kind, 'unchanged')
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(), changes)
    assert.equal(app.model.requests.length, before)
    const id = app.ctx.theone.store.createTopic('Local backend topic')
    const update = await (await get(String(queryFor(cursor, app.gateway.id)))).json() as BubbleReadResponse
    assert.equal(update.kind, 'update'); if (update.kind !== 'update') return
    assert.equal(update.reset, false)
    assert.ok(update.snapshot.topics.some(t => t.id === id))
    assert.ok(update.events.some(e => e.type === 'topic.changed' && e.contextId === id && e.change === 'created'))
    assert.ok(update.events.every(e => e.version <= update.snapshot.cursor.version && e.seq <= update.snapshot.cursor.seq))
    if (process.env.BUBBLE_EXAMPLE_PATH) await writeFile(process.env.BUBBLE_EXAMPLE_PATH, JSON.stringify(update, null, 2) + '\n')
    const at = update.snapshot.cursor
    assert.throws(() => app.ctx.theone.store.replaceHidden([{ id, reason: 'excluded' }, { id: 'missing', reason: 'excluded' }]))
    const rolledBack = await (await get(String(queryFor(at, app.gateway.id)))).json() as BubbleReadResponse
    assert.equal(rolledBack.kind, 'unchanged')
    app.ctx.theone.store.replaceHidden([{ id, reason: 'excluded' }])
    const hidden = await (await get(String(queryFor(at, app.gateway.id)))).json() as BubbleReadResponse
    assert.equal(hidden.kind, 'update'); if (hidden.kind !== 'update') return
    assert.equal(hidden.snapshot.topics.some(t => t.id === id), false)
    assert.equal(JSON.stringify(hidden.events).includes(id), false)
    assert.ok(hidden.snapshot.cursor.seq > at.seq)
    const bad = await get('since=-1'); assert.equal(bad.status, 400)
    assert.equal((await get('gatewayId=another-profile')).status, 404)
    for (const [values, reason] of [[{ epoch: 'previous' }, 'epoch_changed'], [{ since: String(at.version + 1000) }, 'cursor_ahead'], [{ gatewayKey: 'previous-profile' }, 'scope_changed']] as const) {
      const q = queryFor(hidden.snapshot.cursor, app.gateway.id); for (const [key, value] of Object.entries(values)) q.set(key, value)
      const reset = await (await get(String(q))).json() as BubbleReadResponse
      assert.equal(reset.kind === 'update' && reset.resetReason, reason)
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('mount learning emits only a hint and explicit correction and undo retain their meaning', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-hint-')), app = await harness(root)
  try {
    const { ask } = await import('./harness.ts')
    const connection = new HostConnectionService(app.ctx, [], undefined as never), handler = peered(connection)
    await new Promise<void>(resolve => setImmediate(resolve))
    const first = await ask(app.gateway, 'Qwen hardware')
    const head = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id }); assert.equal(head.kind, 'update'); if (head.kind !== 'update') return
    const post = (path: string, body: unknown) => handler.fetch(new Request('http://dsh.internal/api/theone/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    assert.equal((await post('context/mount', { contextId: 'ctx_thesis' })).status, 200)
    let cursor = head.snapshot.cursor
    const hint = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id, epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(hint.kind, 'update'); if (hint.kind !== 'update') return
    assert.ok(hint.events.some(e => e.type === 'route.hint'))
    assert.equal(hint.events.some(e => e.type === 'route.moved'), false)
    cursor = hint.snapshot.cursor
    assert.equal((await post('routes', { messageId: first.input.id, contextId: 'ctx_thesis' })).status, 200)
    const moved = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id, epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(moved.kind, 'update'); if (moved.kind !== 'update') return
    assert.ok(moved.events.some(e => e.type === 'route.moved' && e.cause === 'explicit' && e.reexecute === false))
    cursor = moved.snapshot.cursor
    assert.equal((await post('routes', { messageId: first.input.id, undo: true })).status, 200)
    const undo = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id, epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(undo.kind, 'update'); if (undo.kind !== 'update') return
    assert.ok(undo.events.some(e => e.type === 'route.moved' && e.cause === 'undo' && e.fromId === 'ctx_thesis' && e.toId === 'ctx_qwen_9070xt'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('committed merge and unmerge events retain the removed source id without exposing excluded topics', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-merge-')), app = await harness(root)
  try {
    const store = app.ctx.theone.store
    store.rememberGateway('test-gateway', app.gateway.id)
    const initial = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id }); if (initial.kind !== 'update') throw new Error('missing head')
    const cursor = initial.snapshot.cursor
    store.mergeTopics('ctx_thesis', 'ctx_qwen_9070xt')
    const merged = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id, epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(merged.kind, 'update'); if (merged.kind !== 'update') return
    assert.ok(merged.events.some(e => e.type === 'topic.merged' && e.sourceId === 'ctx_thesis' && e.targetId === 'ctx_qwen_9070xt'))
    assert.equal(merged.snapshot.topics.some(topic => topic.id === 'ctx_thesis'), false)
    store.unmergeTopic('ctx_thesis')
    const undone = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id, epoch: merged.snapshot.cursor.epoch, since: merged.snapshot.cursor.version, after: merged.snapshot.cursor.seq })
    assert.equal(undone.kind, 'update'); if (undone.kind !== 'update') return
    assert.ok(undone.events.some(e => e.type === 'topic.unmerged' && e.sourceId === 'ctx_thesis' && e.targetId === 'ctx_qwen_9070xt'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('open-session metadata survives restart and includes archived cold sources without loading Workers', { timeout: 15000 }, async () => {
  const { SessionId } = await import('@deepseek-ai/dsh-session')
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-sessions-'))
  let app = await harness(root)
  try {
    const older = (await app.ctx.agents.create({ sessionId: SessionId('a-old-source'), agentOptions: { provider: 'fixture', model: 'fixture' } })).agent.session
    await new Promise(resolve => setTimeout(resolve, 5))
    const newer = (await app.ctx.agents.create({ sessionId: SessionId('z-new-source'), agentOptions: { provider: 'fixture', model: 'fixture' } })).agent.session
    const store = app.ctx.theone.store
    store.attachSession('ctx_thesis', older.id); store.attachSession('ctx_thesis', newer.id)
    store.mount('test-gateway', 'ctx_thesis')
    store.replaceHidden([{ id: 'ctx_thesis', reason: 'archived' }])
    const workerId = store.contexts().find(t => t.id === 'ctx_thesis')!.workingSessionId
    await app.ctx.sessions.flush(older); await app.ctx.sessions.flush(newer)
    await app.close(); app = await harness(root)
    assert.ok((await app.ctx.sessionQuery.listSessions()).some(r => r.header.id === newer.id), 'newer source must be materialized on disk')
    const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
    await new Promise<void>(resolve => setImmediate(resolve))
    const response = await handler.fetch(new Request('http://dsh.internal/api/theone/bubbles'))
    const read = await response.json() as BubbleReadResponse
    assert.equal(read.kind, 'update'); if (read.kind !== 'update') return
    assert.equal(read.snapshot.topics.find(t => t.id === 'ctx_thesis')!.openSessionId, newer.id)
    assert.equal(app.model.requests.length, 0)
    assert.equal(app.ctx.agents.get(SessionId(workerId)), undefined)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
