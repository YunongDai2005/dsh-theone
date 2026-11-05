import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { harness, ask, peered, textResponse } from './harness.ts'

const source = 'ctx_qwen_9070xt', target = 'ctx_thesis'
async function setup(root: string) {
  const app = await harness(root)
  const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
  await new Promise<void>(resolve => setImmediate(resolve))
  app.ctx.theone.store.rememberGateway('test-gateway', app.gateway.id)
  const post = async (body: unknown) => {
    const response = await handler.fetch(new Request('http://dsh.internal/api/theone/topics', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { status: response.status, body: await response.json() as Record<string, any> }
  }
  return { ...app, post }
}
const merge = (requestId: string, id = source, into = target) => ({ action: 'merge', id, into, whenIdle: true, requestId })
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('merge did not settle')
}

test('idle queued-merge requests complete with 200 and replay the same durable receipt', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-')), app = await setup(root)
  try {
    const result = await app.post(merge('idle'))
    assert.equal(result.status, 200)
    assert.equal(result.body.state, 'succeeded')
    assert.ok(result.body.operationId)
    assert.deepEqual(await app.post(merge('idle')), result)
    assert.equal((await app.post(merge('idle', target, source))).status, 409)
    assert.equal((await app.post({ ...merge('idle'), whenIdle: false })).status, 409)
    assert.equal((await app.post({ action: 'cancelMerge', operationId: result.body.operationId })).status, 409)
    assert.equal(app.model.requests.length, 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('busy merges queue with 202, reject overlaps, then publish both merge and operation completion', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-')), app = await setup(root)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* () { entered.resolve(); await release.promise; yield* textResponse('kept answer') }
    const reply = ask(app.gateway, 'Qwen hardware'); await entered.promise
    const head = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id }); assert.equal(head.kind, 'update'); if (head.kind !== 'update') return
    assert.equal((await app.post({ action: 'merge', id: source, into: target })).status, 409)
    const queued = await app.post(merge('busy'))
    assert.equal(queued.status, 202); assert.equal(queued.body.state, 'queued')
    assert.ok(queued.body.expiresAt > queued.body.createdAt)
    assert.deepEqual(await app.post(merge('busy')), queued)
    const third = app.ctx.theone.store.createTopic('Third topic')
    for (const [id, into] of [[target, source], [source, third], [third, target], [target, third], [third, source]]) {
      const rejected = await app.post(merge(id + into, id, into))
      assert.equal(rejected.status, 409); assert.equal(rejected.body.error, 'MERGE_CONFLICT')
    }
    assert.equal(app.ctx.theone.bubbleView(app.gateway.id).merges.length, 1)
    release.resolve(); assert.equal((await reply).output, 'kept answer')
    await until(() => !app.ctx.theone.store.contexts().some(c => c.id === source))
    const done = await app.post(merge('busy'))
    assert.equal(done.status, 200); assert.equal(done.body.operationId, queued.body.operationId)
    const cursor = head.snapshot.cursor
    const update = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id, epoch: cursor.epoch, since: cursor.version, after: cursor.seq })
    assert.equal(update.kind, 'update'); if (update.kind !== 'update') return
    assert.ok(update.events.some(e => e.type === 'topic.merged' && e.sourceId === source && e.targetId === target))
    assert.ok(update.events.some(e => e.type === 'merge.changed' && e.state === 'succeeded'))
    assert.deepEqual(update.snapshot.merges, [])
    assert.equal(app.model.requests.length, 1)
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('queued cancellation is idempotent and restart retains cancelled receipts without executing', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-'))
  let app = await setup(root)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* () { entered.resolve(); await release.promise; yield* textResponse('answer') }
    const reply = ask(app.gateway, 'Qwen hardware'); await entered.promise
    const queued = await app.post(merge('cancel'))
    assert.equal(queued.status, 202)
    const body = { action: 'cancelMerge', operationId: queued.body.operationId }
    const cancelled = await app.post(body)
    assert.equal(cancelled.status, 200); assert.equal(cancelled.body.state, 'cancelled')
    assert.deepEqual(await app.post(body), cancelled)
    assert.equal((await app.post(merge('cancel'))).status, 409)
    const restart = await app.post(merge('restart')); assert.equal(restart.status, 202)
    const closing = app.close(); release.resolve(); await reply; await closing
    app = await setup(root)
    const receipt = await app.post(merge('restart'))
    assert.equal(receipt.status, 409); assert.equal(receipt.body.error, 'MERGE_RESTARTED')
    assert.equal(receipt.body.operationId, restart.body.operationId)
    assert.equal(receipt.body.state, 'cancelled')
    assert.ok(app.ctx.theone.store.contexts().some(c => c.id === source))
    assert.deepEqual(app.ctx.theone.bubbleView(app.gateway.id).merges, [])
    assert.equal(app.model.requests.length, 0)
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('execution revalidates a queued target that was removed', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-')), app = await setup(root)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* () { entered.resolve(); await release.promise; yield* textResponse('answer') }
    const reply = ask(app.gateway, 'Qwen hardware'); await entered.promise
    const queued = await app.post(merge('removed')); assert.equal(queued.status, 202)
    app.ctx.theone.store.deleteTopic(target)
    release.resolve(); await reply
    await until(() => app.ctx.theone.mergeQueue.active().length === 0)
    const result = await app.post(merge('removed'))
    assert.equal(result.status, 409); assert.equal(result.body.error, 'UNKNOWN_CONTEXT')
    assert.equal(result.body.state, 'failed')
    assert.ok(app.ctx.theone.store.contexts().some(c => c.id === source))
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('maintenance lease prevents starting a Worker during merge disposal', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-')), app = await setup(root)
  const disposing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    await ask(app.gateway, 'Qwen hardware')
    const workers = (app.ctx.theone as any).workers as Map<string, { dispose(): Promise<void> }>
    const worker = workers.get(source)!, dispose = worker.dispose.bind(worker)
    t.mock.method(worker, 'dispose', async () => { disposing.resolve(); await release.promise; await dispose() })
    const pending = app.post(merge('race')); await disposing.promise
    assert.equal(app.ctx.theone.bubbleView(app.gateway.id).merges[0]?.state, 'executing')
    const executing = await app.post(merge('race'))
    assert.equal(executing.status, 202)
    assert.equal((await app.post({ action: 'cancelMerge', operationId: executing.body.operationId })).body.error, 'MERGE_EXECUTING')
    const newInput = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Qwen hardware again' }] })
    app.gateway.followup(newInput)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(app.model.requests.length, 1, 'no Worker may start inside maintenance')
    release.resolve(); assert.equal((await pending).status, 202)
    await app.gateway.whenIdle()
    await until(() => !app.ctx.theone.store.contexts().some(c => c.id === source))
    assert.equal(app.model.requests.length, 2)
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('expired operations never execute and observation reads do not expire or write receipts', async () => {
  const { TopicMergeQueue } = await import('../src/topic-merge-queue.ts')
  let now = 1000, busy = true, executions = 0, changes = 0
  const queue = new TopicMergeQueue(':memory:', {
    validate: () => {}, busy: () => busy, execute: async () => { executions++ }, committed: () => false,
    changed: () => { changes++ },
  }, () => now, 100)
  try {
    const op = await queue.request('a', 'b', 'expire', true)
    now = 1100
    const before = changes
    assert.equal(queue.active()[0].state, 'queued')
    assert.equal(changes, before)
    busy = false; await queue.drain()
    const receipt = await queue.request('a', 'b', 'expire', true)
    assert.equal(receipt.operationId, op.operationId)
    assert.equal(receipt.state, 'expired'); assert.equal(receipt.error, 'MERGE_EXPIRED')
    assert.equal(executions, 0)
  } finally { await queue.close() }
})

test('queued merge snapshots are read-only and do not call a model', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-')), app = await setup(root)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* () { entered.resolve(); await release.promise; yield* textResponse('answer') }
    const reply = ask(app.gateway, 'Qwen hardware'); await entered.promise
    const queued = await app.post(merge('read')); assert.equal(queued.status, 202)
    const dbs = [(app.ctx.theone.store as any).db, (app.ctx.theone.mergeQueue as any).db]
    const before = dbs.map(db => db.prepare('SELECT total_changes() AS n').get())
    const calls = app.model.requests.length
    for (let i = 0; i < 3; i++) {
      assert.equal(app.ctx.theone.bubbleView(app.gateway.id).merges[0].operationId, queued.body.operationId)
      app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id })
    }
    assert.deepEqual(dbs.map(db => db.prepare('SELECT total_changes() AS n').get()), before)
    assert.equal(app.model.requests.length, calls)
    await app.post({ action: 'cancelMerge', operationId: queued.body.operationId })
    release.resolve(); await reply
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a project waiting to start does not block startup in an independent project', { timeout: 15000 }, async () => {
  const { mkdir } = await import('node:fs/promises')
  const { FixtureModel } = await import('./harness.ts')
  const { ROUTING_PROMPT } = await import('../src/llm-router.ts')
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-projects-')), other = join(root, 'other')
  await mkdir(other)
  const gate = Promise.withResolvers<void>(), model = new FixtureModel(), ids: string[] = [], started: string[] = []
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text)
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: ids[payload.text.includes('second') ? 1 : payload.text.includes('third') ? 2 : 0], reason: 'fixture' })); return
    }
    const descriptor = options.messages.find(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context')
    started.push((descriptor as any).source.contextId)
    await gate.promise; yield* textResponse('answer')
  }
  const app = await harness(root, model, { routerMode: 'llm', cwd: root })
  try {
    for (const [i, folder] of [root, root, other].entries()) ids.push(app.ctx.theone.store.plan('seed-' + i, app.gateway.id, 'test-gateway',
      { action: 'CREATE', title: 'Project ' + i, folder, reason: 'fixture' }, false).decision.contextId!)
    const first = ask(app.gateway, 'first project'); await until(() => started.includes(ids[0]))
    app.gateway.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'second project' }] }))
    await until(() => app.ctx.theone.bubbleView(app.gateway.id).workItems.some(w => w.contextId === ids[1] && w.queueReason === 'project_busy'))
    app.gateway.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'third project' }] }))
    await until(() => started.includes(ids[2]))
    assert.equal(started.includes(ids[1]), false)
    gate.resolve(); await first; await app.gateway.whenIdle()
  } finally { gate.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('crash recovery cancels persisted pending work and recognizes an already committed merge', async () => {
  const { TopicMergeQueue } = await import('../src/topic-merge-queue.ts')
  const { openDatabase } = await import('../src/sqlite.ts')
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-recovery-')), path = join(root, 'merges.db')
  const db = openDatabase(path, 1000)
  db.exec('CREATE TABLE merge_operations (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, receipt TEXT NOT NULL)')
  for (const [id, state] of [['queued', 'queued'], ['executing', 'executing'], ['committed', 'executing']]) {
    db.prepare('INSERT INTO merge_operations VALUES (?, ?, ?)').run(id, id, JSON.stringify({ operationId: id, requestId: id,
      sourceId: id, targetId: 'target', whenIdle: true, state, createdAt: 1, updatedAt: 2, expiresAt: 1000 }))
  }
  db.close()
  let executions = 0
  const queue = new TopicMergeQueue(path, { validate: () => {}, busy: () => false, execute: async () => { executions++ },
    committed: op => op.operationId === 'committed', changed: () => {} }, () => 50)
  try {
    await queue.drain()
    for (const id of ['queued', 'executing']) {
      const receipt = await queue.request(id, 'target', id, true)
      assert.equal(receipt.state, 'cancelled'); assert.equal(receipt.error, 'MERGE_RESTARTED')
    }
    assert.equal((await queue.request('committed', 'target', 'committed', true)).state, 'succeeded')
    assert.equal(executions, 0); assert.deepEqual(queue.active(), [])
  } finally { await queue.close(); await rm(root, { recursive: true, force: true }) }
})
