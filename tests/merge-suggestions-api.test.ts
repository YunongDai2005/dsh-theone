import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import { CARD_PROMPT } from '../src/topic-memory.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { MERGE_VET_PROMPT } from '../src/merge-vetting.ts'
import { harness, ask, FixtureModel, peered, textResponse } from './harness.ts'

const OLD = 'ctx_thesis'
async function fixture(root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'theone-sidebar-suggestion-'))
  const model = new FixtureModel(), app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true } })
  const gatewayHandle = await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'theone', model: 'gateway' } })
  const gateway = gatewayHandle.agent
  let questionCount = 0
  await app.ctx.plugin(UserQuestions)
  app.ctx.on('user-questions/request', async () => { questionCount++; return { answers: [] } })
  const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
  await new Promise<void>(resolve => setImmediate(resolve))
  const store = app.ctx.theone.store
  const card = { summary: 'Thesis chapter', aliases: ['THESIS-2026', 'ChapterThree'], entities: [], settled: [], open: [] }
  store.applyCard(OLD, card)
  let created: string | undefined, workerGate: (() => Promise<void>) | undefined
  model.behavior = async function* (request) {
    if (request.system?.startsWith(ROUTING_PROMPT)) {
      yield* textResponse(JSON.stringify(created ? { action: 'EXISTING', contextId: created, reason: 'fixture' }
        : { action: 'CREATE', title: 'Chapter three', historyIndependent: true, reason: 'fixture' })); return
    }
    if (request.system === CARD_PROMPT) { yield* textResponse(JSON.stringify(card)); return }
    if (request.system === MERGE_VET_PROMPT) {
      const payload = JSON.parse((request.messages[0].content as readonly { text: string }[])[0].text)
      yield* textResponse(JSON.stringify({ decisions: payload.pairs.map((pair: any) => ({ pairId: pair.pairId,
        sameMatter: true, confidence: 0.96, keepId: pair.topics.find((topic: any) => topic.id !== created)?.id ?? pair.topics[1].id,
        reason: '同一章论文' })) })); return
    }
    await workerGate?.(); yield* textResponse('Only the requested answer')
  }
  const post = async (body: unknown, path = 'topics') => {
    const response = await handler.fetch(new Request('http://dsh.internal/api/theone/' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { status: response.status, body: await response.json() as Record<string, any> }
  }
  const snapshot = (gatewayId = gateway.id) => app.ctx.theone.bubbleView(gatewayId) as any
  const start = async () => {
    const reply = await ask(gateway, 'Write the thesis chapter')
    created = store.route(reply.input.id)!.decision.contextId
    await app.ctx.theone.extracting
    await (app.ctx.theone as any).mergeVetter.tick()
    const suggestions = snapshot().mergeSuggestions
    assert.equal(suggestions?.length, 1, 'first card must publish one sidebar suggestion')
    return suggestions[0] as any
  }
  return { ...app, gateway, otherGateway: app.gateway, gatewayHandle, root, store, post, snapshot, start,
    questionCount: () => questionCount,
    routeTo: (id: string) => { created = id },
    holdWorker: (gate: () => Promise<void>) => { workerGate = gate },
    respond: (suggestionId: string, response: string, extra = {}) => post({ action: 'mergeSuggestion', suggestionId, response, ...extra }),
  }
}
const clean = async (app: Awaited<ReturnType<typeof fixture>>) => { await app.close(); await rm(app.root, { recursive: true, force: true }) }

for (const reverse of [false, true]) test(`two windows accept one suggestion exactly once (reverse=${reverse})`, { timeout: 15000 }, async () => {
  const app = await fixture()
  try {
    const s = await app.start(), direction = s.directions[reverse ? 1 : 0]
    assert.deepEqual(s.pair, [...s.pair].sort())
    assert.equal(s.scope.gatewayId, app.gateway.id)
    assert.equal(s.evidence.sharedNames, 2)
    assert.equal(typeof s.evidence.titleSimilarity, 'number')
    assert.ok(s.expiresAt > s.createdAt)
    assert.equal(app.store.mergePrompt(...s.pair as [string, string]), undefined, 'a reservation is not a user decision')
    const calls = app.model.requests.length
    const results = await Promise.all([app.respond(s.suggestionId, 'accept', { ...direction, requestId: 'window-a' }),
      app.respond(s.suggestionId, 'accept', { ...direction, requestId: 'window-b' })])
    assert.ok(results.every(r => [200, 202].includes(r.status)))
    assert.equal(results[0].body.operationId, results[1].body.operationId)
    assert.equal(app.store.merges().length, 1)
    const replay = await app.respond(s.suggestionId, 'accept', direction)
    assert.equal(replay.status, 200); assert.equal(replay.body.state, 'succeeded')
    assert.equal(replay.body.suggestion.state, 'accepted')
    assert.equal(app.store.mergePrompt(...s.pair as [string, string])?.answer, 'merged')
    assert.equal(app.snapshot().mergeSuggestions.length, 0)
    assert.equal(app.snapshot().mergeReceipts.find((r: any) => r.operationId === replay.body.operationId)?.state, 'succeeded')
    assert.equal(app.model.requests.length, calls)
    assert.equal(app.gateway.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source.kind === 'theone-note'), false)
    assert.equal(app.questionCount(), 0)
    assert.equal((await app.respond(s.suggestionId, 'accept', s.directions[reverse ? 0 : 1])).body.error, 'SUGGESTION_CONFLICT')
  } finally { await clean(app) }
})

test('later keeps the pending suggestion; decline suppresses only the pair without learning, done or negative links', { timeout: 15000 }, async () => {
  const app = await fixture()
  try {
    const s = await app.start(), before = app.store.links(), declared = app.store.declaredTopics()
    const db = (app.store as any).db, learning = db.prepare('SELECT * FROM learning_events').all()
    assert.equal((await app.respond(s.suggestionId, 'later')).body.suggestion.state, 'pending')
    assert.equal(app.snapshot().mergeSuggestions[0].suggestionId, s.suggestionId)
    assert.equal(app.store.mergePrompt(...s.pair as [string, string]), undefined)
    const declined = await app.respond(s.suggestionId, 'decline')
    assert.equal(declined.status, 200); assert.equal(declined.body.suggestion.state, 'declined')
    assert.deepEqual(await app.respond(s.suggestionId, 'decline'), declined)
    assert.equal(app.store.mergePrompt(...s.pair as [string, string])?.answer, 'declined')
    assert.deepEqual(app.store.links(), before); assert.deepEqual(app.store.declaredTopics(), declared)
    assert.deepEqual(db.prepare('SELECT * FROM learning_events').all(), learning)
    ;(app.ctx.theone as any).queueMergeSuggestion(s.directions[0].sourceId)
    assert.deepEqual(app.snapshot().mergeSuggestions, [])
    assert.equal((await app.respond(s.suggestionId, 'accept')).body.error, 'SUGGESTION_FINISHED')
  } finally { await clean(app) }
})

for (const action of ['delete', 'move', 'hide', 'edit'] as const) test(`${action} invalidates the old suggestion and late acceptance cannot merge`, { timeout: 15000 }, async () => {
  const app = await fixture()
  try {
    const s = await app.start()
    if (action === 'delete') app.store.deleteTopic(OLD)
    if (action === 'move') app.store.moveTopic(OLD, { title: 'Explicit workspace' })
    if (action === 'hide') app.store.replaceHidden([{ id: OLD, reason: 'excluded' }])
    if (action === 'edit') app.store.editTopic(OLD, { title: 'Renamed by user' })
    const result = await app.respond(s.suggestionId, 'accept')
    assert.equal(result.status, 409); assert.equal(result.body.error, 'SUGGESTION_INVALID')
    assert.deepEqual(app.snapshot().mergeSuggestions, []); assert.deepEqual(app.store.merges(), [])
  } finally { await clean(app) }
})

test('pending suggestions survive plugin restart and full snapshots recover event gaps', { timeout: 15000 }, async () => {
  let app = await fixture()
  const root = app.root
  try {
    const s = await app.start(), gatewayId = app.gateway.id
    await app.close(); app = await fixture(root)
    const reset = app.ctx.theone.bubbles.read({ gatewayId, epoch: 'old-epoch', since: 0, after: 0 })
    assert.equal(reset.kind, 'update'); if (reset.kind !== 'update') return
    assert.equal(reset.resetReason, 'epoch_changed')
    assert.equal((reset.snapshot as any).mergeSuggestions[0].suggestionId, s.suggestionId)
    assert.equal((await app.respond(s.suggestionId, 'later')).status, 200)
    assert.equal((await app.respond(s.suggestionId, 'accept')).status, 200)
  } finally { await clean(app) }
})

test('a busy accept queues globally and moving either topic before execution invalidates the operation', { timeout: 15000 }, async () => {
  const app = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    const s = await app.start()
    app.holdWorker(async () => { entered.resolve(); await release.promise })
    const running = ask(app.gateway, 'Continue'); await entered.promise
    const queued = await app.respond(s.suggestionId, 'accept')
    assert.equal(queued.status, 202); assert.equal(queued.body.state, 'queued')
    assert.ok(queued.body.operationId)
    assert.equal(app.store.mergePrompt(...s.pair as [string, string]), undefined)
    app.store.moveTopic(OLD, { title: 'Changed during wait' })
    release.resolve(); await running; await app.ctx.theone.mergeQueue.drain()
    const receipt = await app.respond(s.suggestionId, 'accept')
    assert.equal(receipt.status, 409)
    assert.ok(['cancelled', 'failed'].includes(receipt.body.state))
    assert.deepEqual(app.store.merges(), [])
  } finally { release.resolve(); await clean(app) }
})

test('expiry cleans pending suggestions without a chat notice', { timeout: 15000 }, async t => {
  const app = await fixture()
  try {
    const s = await app.start()
    t.mock.timers.enable({ apis: ['Date'], now: s.expiresAt + 1 })
    const expired = await app.respond(s.suggestionId, 'accept')
    assert.equal(expired.status, 409); assert.equal(expired.body.error, 'SUGGESTION_EXPIRED')
    assert.deepEqual(app.snapshot().mergeSuggestions, [])
  } finally { t.mock.timers.reset(); await clean(app) }
})

test('closing the gateway invalidates pending suggestions', { timeout: 15000 }, async () => {
  const app = await fixture()
  try {
    const s = await app.start()
    await app.gatewayHandle.dispose()
    assert.deepEqual(app.snapshot().mergeSuggestions, [])
    assert.equal((await app.respond(s.suggestionId, 'accept')).body.error, 'SUGGESTION_INVALID')
  } finally { await clean(app) }
})

test('a topic moved away and back during worker disposal still invalidates the accepted suggestion', { timeout: 15000 }, async t => {
  const app = await fixture(), disposing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    const s = await app.start(), sourceId = s.directions[0].sourceId
    const worker = (app.ctx.theone as any).workers.get(sourceId), dispose = worker.dispose.bind(worker)
    t.mock.method(worker, 'dispose', async () => { disposing.resolve(); await release.promise; await dispose() })
    const request = app.respond(s.suggestionId, 'accept'); await disposing.promise
    // Preserve the original fingerprint at the end; the intervening edit must still invalidate it.
    const title = app.store.contexts().find(topic => topic.id === OLD)!.title
    app.store.editTopic(OLD, { title: 'Temporarily changed' }); app.store.editTopic(OLD, { title })
    release.resolve()
    const receipt = await request
    assert.equal(receipt.status, 409); assert.equal(receipt.body.error, 'TOPIC_CHANGED')
    assert.deepEqual(app.store.merges(), [])
    assert.equal(app.questionCount(), 0)
    assert.equal(app.gateway.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source.kind === 'theone-note'), false)
  } finally { release.resolve(); await clean(app) }
})

test('suggestion events are gateway scoped and event gaps recover pending state without writes', async () => {
  const app = await fixture()
  try {
    app.store.rememberGateway('test-gateway', app.otherGateway.id)
    const otherInitial = app.ctx.theone.bubbles.read({ gatewayId: app.otherGateway.id })
    assert.equal(otherInitial.kind, 'update'); if (otherInitial.kind !== 'update') return
    app.store.rememberGateway('test-gateway', app.gateway.id)
    const initial = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id })
    assert.equal(initial.kind, 'update'); if (initial.kind !== 'update') return
    const cursor = initial.snapshot.cursor, s = await app.start()
    const query = { gatewayId: app.gateway.id, epoch: cursor.epoch, since: cursor.version, after: cursor.seq }
    const appeared = app.ctx.theone.bubbles.read(query)
    assert.equal(appeared.kind, 'update'); if (appeared.kind !== 'update') return
    assert.equal(appeared.events.filter(e => e.type === 'mergeSuggestion.appeared').length, 1)
    const db = (app.store as any).db, before = db.prepare('SELECT total_changes() AS n').get()
    for (let i = 0; i < 3; i++) app.ctx.theone.bubbles.read(query)
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(), before)
    for (let i = 0; i < 520; i++) app.ctx.theone.bubbles.publish([{ type: 'route.blocked', workItemId: 'gap', reason: 'unknown', candidateIds: [] }], app.gateway.id)
    const gap = app.ctx.theone.bubbles.read(query)
    assert.equal(gap.kind, 'update'); if (gap.kind !== 'update') return
    assert.equal(gap.resetReason, 'events_expired')
    assert.equal(gap.snapshot.mergeSuggestions?.[0].suggestionId, s.suggestionId)
    const endCursor = gap.snapshot.cursor
    await app.respond(s.suggestionId, 'decline')
    const end = app.ctx.theone.bubbles.read({ gatewayId: app.gateway.id, epoch: endCursor.epoch, since: endCursor.version, after: endCursor.seq })
    assert.equal(end.kind, 'update'); if (end.kind !== 'update') return
    assert.deepEqual(end.snapshot.mergeSuggestions, [])
    assert.equal(end.events.filter(e => e.type === 'mergeSuggestion.ended' && e.state === 'declined').length, 1)
    const otherCursor = otherInitial.snapshot.cursor
    const other = app.ctx.theone.bubbles.read({ gatewayId: app.otherGateway.id, epoch: otherCursor.epoch, since: otherCursor.version, after: otherCursor.seq })
    assert.equal(other.kind, 'update'); if (other.kind !== 'update') return
    assert.deepEqual(other.snapshot.mergeSuggestions, [])
    assert.equal(other.events.some(e => e.type === 'mergeSuggestion.appeared' || e.type === 'mergeSuggestion.ended'), false)
  } finally { await clean(app) }
})

test('an unrelated busy topic queues acceptance and completion adds no chat cards or notices', async () => {
  const app = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    const s = await app.start()
    app.routeTo('ctx_qwen_9070xt')
    app.holdWorker(async () => { entered.resolve(); await release.promise })
    const running = ask(app.gateway, 'Continue Qwen hardware'); await entered.promise
    const view = app.snapshot()
    assert.ok(view.topics.filter((t: any) => s.pair.includes(t.id)).every((t: any) => !t.capabilities.mergeNow.allowed && t.capabilities.mergeNow.reason === 'gateway_busy'))
    const queued = await app.respond(s.suggestionId, 'accept')
    assert.equal(queued.status, 202)
    release.resolve(); await running; await app.ctx.theone.mergeQueue.drain()
    const completed = await app.respond(s.suggestionId, 'accept')
    assert.equal(completed.status, 200); assert.equal(completed.body.operationId, queued.body.operationId)
    assert.equal(app.questionCount(), 0)
    assert.equal(app.gateway.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source.kind === 'theone-note'), false)
    assert.equal(app.snapshot().mergeReceipts.find((op: any) => op.operationId === queued.body.operationId)?.state, 'succeeded')
  } finally { release.resolve(); await clean(app) }
})

test('restart cancels accepted queued work durably and suggestion retries never launch a second operation', async () => {
  let app = await fixture()
  const root = app.root, entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    const s = await app.start(), gatewayId = app.gateway.id
    app.holdWorker(async () => { entered.resolve(); await release.promise })
    const running = ask(app.gateway, 'Continue'); await entered.promise
    const queued = await app.respond(s.suggestionId, 'accept')
    assert.equal(queued.status, 202)
    const closing = app.close(); release.resolve(); await running; await closing
    app = await fixture(root)
    const receipt = await app.respond(s.suggestionId, 'accept', { requestId: 'new-window-after-restart' })
    assert.equal(receipt.status, 409); assert.equal(receipt.body.error, 'MERGE_RESTARTED')
    assert.equal(receipt.body.operationId, queued.body.operationId)
    assert.equal(app.snapshot(gatewayId).mergeReceipts.find((op: any) => op.operationId === queued.body.operationId)?.state, 'cancelled')
    assert.deepEqual(app.store.merges(), [])
    assert.equal(app.model.requests.length, 0)
  } finally { release.resolve(); await clean(app) }
})

test('invalid suggestion responses cannot be coerced into consent and unknown IDs return 404', async () => {
  const app = await fixture()
  try {
    const s = await app.start()
    for (const response of [['later'], ['accept'], {}, null, 1, 'maybe']) {
      const result = await app.post({ action: 'mergeSuggestion', suggestionId: s.suggestionId, response })
      assert.equal(result.status, 400); assert.equal(result.body.error, 'INVALID_INPUT')
    }
    assert.equal((await app.respond('missing', 'accept')).status, 404)
    assert.equal((await app.respond(s.suggestionId, 'accept', { requestId: '' })).status, 400)
    assert.deepEqual(app.store.merges(), [])
    assert.equal(app.snapshot().mergeSuggestions[0].suggestionId, s.suggestionId)
  } finally { await clean(app) }
})

test('acceptance rechecks similarity when later cards replace the original shared entities', async () => {
  const app = await fixture()
  try {
    const origin = app.store.plan('similarity-seed', app.gateway.id, 'test-gateway', { action: 'CREATE', title: 'Independent investigation', reason: 'fixture' }, false).decision.contextId!
    const other = app.store.createTopic('Candidate archive')
    const card = { summary: 'summary', aliases: [], entities: ['CommonAlpha', 'CommonBeta'], settled: [], open: [] }
    app.store.applyCard(other, card); app.store.applyCard(origin, card)
    ;(app.ctx.theone as any).queueMergeSuggestion(origin)
    await (app.ctx.theone as any).mergeVetter.tick()
    const suggestion = app.snapshot().mergeSuggestions[0]
    assert.ok(suggestion)
    app.store.applyCard(other, { ...card, entities: Array.from({ length: 48 }, (_, i) => 'UnrelatedEntity' + i) })
    const response = await app.respond(suggestion.suggestionId, 'accept')
    assert.equal(response.status, 409); assert.equal(response.body.error, 'SUGGESTION_INVALID')
    assert.deepEqual(app.store.merges(), [])
  } finally { await clean(app) }
})
