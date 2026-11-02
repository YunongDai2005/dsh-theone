import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harness, ask, FixtureModel, textResponse, peered } from './harness.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'

const A = 'ctx_qwen_9070xt', B = 'ctx_thesis'
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'theone-bindings-'))
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: A, reason: 'fixture' })); return
    }
    if (options.system?.includes('从用户的更正中学习')) { yield* textResponse('[]'); return }
    yield* textResponse('Ready?')
  }
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { routingShadow: false } })
  app.ctx.theone.store.mount('test-gateway', A)
  const connection = new HostConnectionService(app.ctx, [], undefined as never)
  await new Promise(resolve => setImmediate(resolve))
  const api = peered(connection)
  const post = async (body: object) => api.fetch(new Request('http://dsh.internal/api/theone/messages', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: app.gateway.id, ...body }),
  }))
  return { ...app, root, post, api, dispose: async () => { await app.close(); await rm(root, { recursive: true, force: true }) } }
}
type App = Awaited<ReturnType<typeof setup>>
function record(app: App, id: string, topicId: string, kind: 'reply' | 'question' | 'approval' = 'reply', source: 'foreground' | 'background' | 'inferred' = 'foreground') {
  assert.ok(app.ctx.theone.bindings, 'product binding registry must exist independently of shadow')
  app.ctx.theone.bindings.record({ id, sessionId: app.gateway.id, topicId, kind, source, sources: [] })
}
async function send(app: App, binding: object, text = '按刚才说的调整') {
  const response = await app.post({ text, binding })
  assert.equal(response?.status, 200, 'authenticated product input endpoint must accept the message')
  const { messageId } = await response!.json() as { messageId: string }
  await app.gateway.whenIdle()
  const route = app.ctx.theone.store.route(messageId)
  const receipt = app.ctx.theone.store.recentRoutes('test-gateway', 50).find(row => row.messageId === messageId)?.receipt
  return { messageId, route, receipt }
}
const routingCalls = (app: App) => app.model.requests.filter(request => request.system?.startsWith(ROUTING_PROMPT))

test('the product input endpoint resolves an observed reply without invoking the router', async () => {
  const app = await setup()
  try {
    const first = await ask(app.gateway, 'Qwen 的当前进度')
    const reply = first.events.findLast(e => e.type === 'assistant/message')!
    app.ctx.theone.store.mount('test-gateway', B)
    app.model.requests.length = 0
    const result = await send(app, { replyTo: app.gateway.id + ':' + reply.seq })
    assert.equal(result.route?.decision.contextId, A)
    assert.equal(result.receipt?.binding?.kind, 'reply')
    assert.equal(result.receipt?.calls, 0)
    assert.equal(routingCalls(app).length, 0)
  } finally { await app.dispose() }
})

for (const kind of ['question', 'approval'] as const) test('an explicit ' + kind + ' id selects its owner among competing pending requests', async () => {
  const app = await setup()
  try {
    record(app, 'first', A, kind); record(app, 'chosen', B, kind)
    const result = await send(app, { pendingResponse: 'chosen' })
    assert.equal(result.route?.decision.contextId, B)
    assert.equal(result.receipt?.binding?.kind, kind)
    assert.equal(routingCalls(app).length, 0)
    assert.equal(app.ctx.theone.store.learningJournal.stage(app.ctx.theone.store.learningJournal.source(result.messageId, B)), 'inferred')
  } finally { await app.dispose() }
})

for (const scenario of ['conflict', 'duplicate-owner', 'deleted', 'closed', 'background', 'inferred', 'unknown'] as const)
test(scenario + ' binding falls back to model classification even for a bare continuation', async () => {
  const app = await setup()
  try {
    const kind = scenario === 'closed' ? 'question' : 'reply'
    if (scenario !== 'unknown') record(app, 'ref', B, kind, scenario === 'background' ? 'background' : scenario === 'inferred' ? 'inferred' : 'foreground')
    if (scenario === 'duplicate-owner') record(app, 'ref', A)
    if (scenario === 'conflict') record(app, 'other', A, 'question')
    if (scenario === 'deleted') app.ctx.theone.store.deleteTopic(B)
    if (scenario === 'closed') app.ctx.theone.bindings.closeReference('ref')
    const result = await send(app, { ...(kind === 'question' ? { pendingResponse: 'ref' } : { replyTo: 'ref' }),
      ...(scenario === 'conflict' ? { pendingResponse: 'other' } : {}) }, '继续')
    assert.equal(result.route?.decision.contextId, A)
    assert.ok(routingCalls(app).length > 0)
    assert.equal(result.receipt?.binding?.status, 'rejected')
  } finally { await app.dispose() }
})

test('foreground and background provenance reach the classifier without granting a binding', async () => {
  const app = await setup()
  try {
    record(app, 'front', A); record(app, 'notice', B, 'reply', 'background')
    await send(app, {}, '下一步该怎么处理这个方案')
    const payload = JSON.parse(routingCalls(app)[0].messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
    assert.equal(payload.attention.foreground.topicId, A)
    assert.equal(payload.attention.background[0].topicId, B)
    assert.ok(routingCalls(app).length > 0)
  } finally { await app.dispose() }
})

test('a foreground reply alone adds no attention field, so ordinary requests stay as they were', async () => {
  const app = await setup()
  try {
    record(app, 'front', A)
    await send(app, {}, '下一步该怎么处理这个方案')
    const call = routingCalls(app)[0]
    const payload = JSON.parse(call.messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
    assert.equal('attention' in payload, false)
    assert.equal(JSON.stringify(call).includes('attention.foreground'), false)
  } finally { await app.dispose() }
})

test('a corrected bound route retracts learning and invalidates replies produced by that route', async () => {
  const app = await setup()
  try {
    record(app, 'ref', B)
    const result = await send(app, { replyTo: 'ref' })
    const store = app.ctx.theone.store
    const source = store.learningJournal.source(result.messageId, B)
    store.withLearning([source], () => store.learnTerms(B, ['binding-poison'], 8))
    assert.ok(store.learnedTerms().get(B)?.includes('binding-poison'))
    const reply = app.gateway.session.snapshotEvents().findLast(e => e.type === 'assistant/message')!
    const response = await app.api.fetch(new Request('http://dsh.internal/api/theone/routes', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: result.messageId, contextId: A }) }))
    assert.equal(response?.status, 200)
    await app.ctx.theone.learning
    assert.equal(store.learningJournal.valid([source]), false)
    assert.ok(!store.learnedTerms().get(B)?.includes('binding-poison'))
    app.model.requests.length = 0
    await send(app, { replyTo: app.gateway.id + ':' + reply.seq })
    assert.ok(routingCalls(app).length > 0)
  } finally { await app.dispose() }
})

for (const automatic of [false, true]) test((automatic ? 'an automatic continuation' : 'a bound route') + ' still checks another project before executing a write', async () => {
  const app = await setup()
  let edits = 0, checks = 0
  try {
    record(app, 'ref', B, automatic ? 'approval' : 'reply')
    await app.ctx.plugin(Storage)
    await app.ctx.plugin(JsonStorage, { root: join(app.root, 'workspace-store') })
    await app.ctx.plugin(StorageDomain, { backend: 'json' })
    await app.ctx.plugin(WorkspaceRegistry)
    const target = join(app.root, 'project-a')
    await mkdir(target); await app.ctx.workspaceRegistry.create(target)
    app.ctx.provide('approval')
    app.ctx.set('approval', { request: async () => { checks++; return 'rejected' } } as never)
    app.ctx.tools.register(defineTool({ name: 'edit', description: 'Synthetic edit', parameters: { file_path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] }, execute: async () => { edits++; return 'edited' } }))
    app.model.behavior = async function* (options) {
      const last = options.messages.findLastIndex(m => m.role === 'user' && 'source' in m && m.source?.kind === 'user')
      if (options.messages.slice(last + 1).some(m => m.role === 'tool')) { yield* textResponse('stopped'); return }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('bound-edit'), name: 'edit', arguments: JSON.stringify({ file_path: join(target, 'report.txt') }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
    const result = await send(app, automatic ? {} : { replyTo: 'ref' }, automatic ? 'ok' : 'follow the reply')
    assert.equal(result.route?.decision.contextId, B)
    assert.equal(checks, 1)
    assert.equal(edits, 0)
  } finally { await app.dispose() }
})

test('restart expires pending requests while retaining verified message provenance', async () => {
  const app = await setup()
  let reopened: Awaited<ReturnType<typeof harness>> | undefined
  try {
    record(app, 'pending', B, 'question'); record(app, 'reply', B)
    await app.close()
    reopened = await harness(app.root, app.model, { routerMode: 'llm' })
    const bindings = reopened.ctx.theone.bindings
    assert.equal(bindings.resolve({ pendingResponse: 'pending' }, new Set([A, B])).status, 'rejected')
    assert.equal(bindings.resolve({ replyTo: 'reply' }, new Set([A, B])).topicId, B)
  } finally { await (reopened?.close() ?? app.close()); await rm(app.root, { recursive: true, force: true }) }
})


test('a stale steering reference cannot bypass the classifier', async () => {
  const app = await setup()
  try {
    const result = await send(app, { steeringOf: 'a-finished-or-invented-turn' }, '继续')
    assert.equal(result.receipt?.binding?.status, 'rejected')
    assert.ok(routingCalls(app).length > 0)
  } finally { await app.dispose() }
})

test('the public input rejects invented ownership fields and an unrelated session', async () => {
  const app = await setup()
  try {
    const malformed = await app.post({ text: 'continue', binding: { topicId: B } })
    assert.equal(malformed?.status, 400)
    const unrelated = await app.post({ sessionId: 'not-a-gateway', text: 'continue' })
    assert.equal(unrelated?.status, 400)
    assert.equal(app.model.requests.length, 0)
  } finally { await app.dispose() }
})

test('same-round explicit steering has a zero-call receipt and retractable learning', async () => {
  const app = await setup()
  let childId: string | undefined
  try {
    app.model.behavior = async function* (options) {
      if (options.system?.startsWith(ROUTING_PROMPT)) {
        yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: A, reason: 'fixture' })); return
      }
      if (!childId) {
        const parent = app.ctx.theone.store.recentRoutes('test-gateway', 1)[0].messageId
        childId = app.ctx.theone.submitMessage(app.gateway.id, '把说明再缩短一点', { steeringOf: parent }, 'steer').id
        await new Promise(resolve => setImmediate(resolve))
      }
      yield* textResponse('done')
    }
    await ask(app.gateway, 'Qwen 的报告')
    assert.ok(childId)
    const receipt = app.ctx.theone.store.routeReceipt(childId)
    assert.equal(receipt?.binding?.kind, 'steering')
    assert.equal(receipt?.calls, 0)
    assert.equal(app.ctx.theone.store.route(childId)?.status, 'completed')
    const source = app.ctx.theone.store.learningJournal.source(childId, A)
    assert.equal(app.ctx.theone.store.learningJournal.stage(source), 'inferred')
    assert.ok(app.ctx.theone.store.learningJournal.turns(app.ctx.theone.store.contexts().find(t => t.id === A)!.workingSessionId)
      .some(turn => turn.source.messageId === childId))
    assert.equal(routingCalls(app).length, 1, 'only the parent input is classified')
  } finally { await app.dispose() }
})


test('an autonomous background relay cannot change the foreground topic or a bare continuation', async () => {
  const app = await setup()
  try {
    app.model.behavior = async function* (options) {
      if (options.system?.startsWith(ROUTING_PROMPT)) {
        const payload = JSON.parse(options.messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
        yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: payload.text.includes('论文') ? B : A, reason: 'fixture' })); return
      }
      yield* textResponse('done')
    }
    await ask(app.gateway, '论文的进度')
    const background = app.ctx.agents.get(SessionId(app.ctx.theone.store.contexts().find(t => t.id === B)!.workingSessionId))!
    await ask(app.gateway, 'Qwen 的进度')
    background.followup(createUserMessage({ source: { kind: 'subagent-settled', form: 'notice', summary: 'done', senderSessionId: 'child' } as never,
      content: [{ type: 'text', text: 'Background finished.' }] }))
    await background.whenIdle()
    await app.gateway.whenIdle()
    assert.equal(app.ctx.theone.store.current('test-gateway'), A)
    const attention = app.ctx.theone.bindings.attention(new Set([A, B]))!
    assert.equal(attention.foreground?.topicId, A)
    assert.ok(attention.background.some(event => event.topicId === B))
    const next = await ask(app.gateway, '继续')
    assert.equal(app.ctx.theone.store.route(next.input.id)?.decision.contextId, A)
  } finally { await app.dispose() }
})


test('a native delayed question answer keeps its host call identity in the routing receipt', async () => {
  const app = await setup()
  try {
    await app.ctx.plugin(UserQuestions)
    app.ctx.tools.register(defineTool({ name: 'ask_user_question', description: 'Synthetic timed question',
      parameters: { timeout: { type: 'number' }, questions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true }, question: { type: 'string', required: true } } } } },
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async () => '{"pending":true}' }))
    let first = true
    app.model.behavior = async function* (options) {
      if (options.system?.startsWith(ROUTING_PROMPT)) {
        yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: B, reason: 'fixture' })); return
      }
      if (first) {
        first = false
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('late-question'), name: 'ask_user_question',
          arguments: JSON.stringify({ timeout: 1, questions: [{ id: 'size', question: 'Which size?' }] }) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('done')
    }
    await ask(app.gateway, '论文的规格')
    app.ctx.theone.store.mount('test-gateway', A)
    app.model.requests.length = 0
    assert.equal(app.ctx.userQuestions.answer(app.gateway, ToolCallId('late-question'), { answers: [{ id: 'size', selected: [], custom: 'small' }] }), true)
    const worker = app.ctx.agents.get(SessionId(app.ctx.theone.store.contexts().find(t => t.id === B)!.workingSessionId))!
    await worker.whenIdle(); await app.gateway.whenIdle()
    const receipt = app.ctx.theone.store.recentRoutes('test-gateway', 1)[0].receipt
    assert.equal(receipt?.binding?.kind, 'question')
    assert.ok(receipt?.binding?.refs?.some(id => id.includes('late-question')))
    assert.equal(receipt?.calls, 0)
    assert.equal(routingCalls(app).length, 0)
    assert.equal(app.ctx.theone.store.current('test-gateway'), B)
    const messageId = app.ctx.theone.store.recentRoutes('test-gateway', 1)[0].messageId
    const learned = app.ctx.theone.store.learningJournal.turns(worker.id).find(turn => turn.source.messageId === messageId)
    assert.ok(learned && learned.endSeq < Number.MAX_SAFE_INTEGER, 'the native answer must not claim every later Worker turn')
  } finally { await app.dispose() }
})


test('correcting a binding ancestor also invalidates replies derived through that binding', async () => {
  const app = await setup()
  try {
    record(app, 'ref', B)
    const first = await send(app, { replyTo: 'ref' })
    const reply1 = app.gateway.session.snapshotEvents().findLast(e => e.type === 'assistant/message')!
    await send(app, { replyTo: app.gateway.id + ':' + reply1.seq })
    const reply2 = app.gateway.session.snapshotEvents().findLast(e => e.type === 'assistant/message')!
    await app.api.fetch(new Request('http://dsh.internal/api/theone/routes', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: first.messageId, contextId: A }) }))
    await app.ctx.theone.learning
    app.model.requests.length = 0
    const last = await send(app, { replyTo: app.gateway.id + ':' + reply2.seq })
    assert.equal(last.receipt?.binding?.status, 'rejected')
    assert.ok(routingCalls(app).length > 0)
  } finally { await app.dispose() }
})

for (const kind of ['question', 'approval'] as const) test('a bare continuation uses the unique live ' + kind + ' owner without user references', async () => {
  const app = await setup()
  try {
    record(app, 'waiting', B, kind)
    const result = await send(app, {}, '继续')
    assert.equal(result.route?.decision.contextId, B)
    assert.equal(result.receipt?.calls, 0)
    assert.equal(result.receipt?.binding, undefined, 'inferred continuation is not an explicit binding')
    assert.equal(app.ctx.theone.store.learningJournal.stage(app.ctx.theone.store.learningJournal.source(result.messageId, B)), 'inferred')
    assert.equal(app.model.requests.filter(r => !r.system?.startsWith(ROUTING_PROMPT)).length, 1, 'one worker executes the input')
  } finally { await app.dispose() }
})

test('a bare continuation follows a non-current foreground reply without a user reference', async () => {
  const app = await setup()
  try {
    record(app, 'front', B)
    const result = await send(app, {}, 'ok')
    assert.equal(result.route?.decision.contextId, B)
    assert.equal(result.receipt?.calls, 0)
    assert.equal(result.receipt?.binding, undefined)
  } finally { await app.dispose() }
})

for (const scenario of ['two-owners', 'same-owner-two-requests', 'foreground-conflict'] as const)
test(scenario + ' delegates a bare continuation to the model with live state', async () => {
  const app = await setup()
  try {
    record(app, 'q', B, 'question')
    if (scenario === 'foreground-conflict') record(app, 'front', A)
    else record(app, 'other', scenario === 'two-owners' ? A : B, 'approval')
    await send(app, {}, '好的')
    assert.ok(routingCalls(app).length > 0, 'conflicting state must not force a fast route')
    const payload = JSON.parse(routingCalls(app)[0].messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
    assert.equal(payload.attention.pending.length, scenario === 'foreground-conflict' ? 1 : 2)
    if (scenario === 'foreground-conflict') assert.equal(payload.attention.foreground.topicId, A)
  } finally { await app.dispose() }
})

test('a non-current foreground source reaches semantic routing even without background events', async () => {
  const app = await setup()
  try {
    record(app, 'front', B)
    await send(app, {}, '下一步该怎么处理这个方案')
    const payload = JSON.parse(routingCalls(app)[0].messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
    assert.equal(payload.attention.foreground.topicId, B)
  } finally { await app.dispose() }
})

for (const invalid of ['closed', 'deleted', 'excluded', 'background'] as const)
test('a ' + invalid + ' pending request cannot capture an unmarked continuation', async () => {
  const app = await setup()
  try {
    const store = app.ctx.theone.store
    const source = store.learningJournal.source('old', B)
    app.ctx.theone.bindings.record({ id: 'old-q', sessionId: app.gateway.id, topicId: B, kind: 'question',
      source: invalid === 'background' ? 'background' : 'foreground', sources: [source] })
    if (invalid === 'closed') app.ctx.theone.bindings.closeReference('old-q')
    if (invalid === 'deleted') store.deleteTopic(B)
    if (invalid === 'excluded') store.learningJournal.move('old', A)
    const result = await send(app, {}, '继续')
    assert.equal(result.route?.decision.contextId, A)
    assert.equal(result.receipt?.calls, 0)
  } finally { await app.dispose() }
})

test('temporary arithmetic is isolated and an unmarked continuation returns to the original topic', async () => {
  const app = await setup()
  try {
    await ask(app.gateway, 'Qwen 的当前进度')
    app.model.requests.length = 0
    const oneoff = await send(app, {}, '17 * 23?')
    assert.equal(oneoff.route?.decision.action, 'CREATE')
    assert.notEqual(oneoff.route?.decision.contextId, A)
    assert.equal(app.ctx.theone.store.current('test-gateway'), A)
    const resumed = await send(app, {}, 'continue')
    assert.equal(resumed.route?.decision.contextId, A)
    assert.equal(resumed.receipt?.calls, 0)
    assert.equal(routingCalls(app).length, 0)
  } finally { await app.dispose() }
})

test('asking why after temporary arithmetic can still refer to the arithmetic reply', async () => {
  const app = await setup()
  try {
    const oneoff = await send(app, {}, '17 * 23?')
    assert.notEqual(oneoff.route?.decision.contextId, A)
    const followup = await send(app, {}, 'why?')
    assert.equal(followup.route?.decision.contextId, oneoff.route?.decision.contextId)
  } finally { await app.dispose() }
})

test('automatic foreground continuation inherits retractable learning sources', async () => {
  const app = await setup()
  try {
    record(app, 'front', B)
    const parent = await send(app, { replyTo: 'front' })
    app.ctx.theone.store.mount('test-gateway', A)
    const child = await send(app, {}, '继续')
    assert.equal(child.route?.decision.contextId, B)
    const store = app.ctx.theone.store
    const sessionId = store.contexts().find(t => t.id === B)!.workingSessionId
    const sources = store.learningJournal.turns(sessionId).find(t => t.source.messageId === child.messageId)!.sources
    assert.ok(sources.some(s => s.messageId === parent.messageId))
    store.withLearning(sources, () => store.learnTerms(B, ['auto-state-poison'], 8))
    const response = await app.api.fetch(new Request('http://dsh.internal/api/theone/routes', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: parent.messageId, contextId: A }) }))
    assert.equal(response?.status, 200)
    await app.ctx.theone.learning
    assert.ok(!store.learnedTerms().get(B)?.includes('auto-state-poison'))
    assert.equal(store.learningJournal.valid(sources), false)
  } finally { await app.dispose() }
})

test('more pending requests than the payload budget remain a conflict', async () => {
  const app = await setup()
  try {
    for (let i = 0; i < 40; i++) record(app, 'q' + i, i % 2 ? A : B, 'question')
    await send(app, {}, '继续')
    assert.ok(routingCalls(app).length > 0)
    const payload = JSON.parse(routingCalls(app)[0].messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
    assert.ok(payload.attention.pending.length <= 8)
    assert.equal(payload.attention.pendingOverflow, true)
  } finally { await app.dispose() }
})

test('temporary arithmetic also works when no topic has been mounted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-first-aside-'))
  const model = new FixtureModel()
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const result = await ask(app.gateway, '17 * 23?')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.action, 'CREATE')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.status, 'completed')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('semantic routing from conflicting state retains the observed sources for retraction', async () => {
  const app = await setup()
  try {
    const store = app.ctx.theone.store
    const source = store.learningJournal.source('pending-parent', B)
    app.ctx.theone.bindings.record({ id: 'q', sessionId: app.gateway.id, topicId: B, kind: 'question', source: 'foreground', sources: [source] })
    record(app, 'front', A)
    const result = await send(app, {}, '那下一步怎么做')
    const worker = store.contexts().find(t => t.id === A)!.workingSessionId
    const parents = store.learningJournal.turns(worker).find(t => t.source.messageId === result.messageId)!.sources
    assert.ok(parents.some(s => s.messageId === 'pending-parent'))
    store.withLearning(parents, () => store.learnTerms(A, ['semantic-state-poison'], 8))
    store.learningJournal.move('pending-parent', A)
    assert.equal(store.learningJournal.valid(parents), false)
    assert.ok(!store.learnedTerms().get(A)?.includes('semantic-state-poison'))
  } finally { await app.dispose() }
})

for (const conflict of [false, true]) test(conflict ? 'semantic in-flight routing preserves pending-state sources' : 'an unmarked continuation arriving during a reply can reach another live pending owner once', async () => {
  const app = await setup()
  let childId: string | undefined
  const text = conflict ? 'explain the next step' : 'continue'
  const delivered: { topicId: string; text: string }[] = []
  try {
    app.model.behavior = async function* (options) {
      if (options.system?.startsWith(ROUTING_PROMPT)) {
        yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: A, reason: 'fixture' })); return
      }
      const context = options.messages.find(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context')
      const topicId = context && 'source' in context ? (context.source as { contextId: string }).contextId : ''
      const last = options.messages.filter(m => m.role === 'user' && 'source' in m && m.source?.kind === 'user').at(-1)
      delivered.push({ topicId, text: last?.content.flatMap(b => b.type === 'text' ? b.text : []).join('') ?? '' })
      if (!childId) {
        const sources = [app.ctx.theone.store.learningJournal.source('wait-parent', B)]
        app.ctx.theone.bindings.record({ id: 'waiting', topicId: B, kind: 'question', sessionId: app.gateway.id, source: 'foreground', sources })
        if (conflict) record(app, 'front', A)
        childId = app.ctx.theone.submitMessage(app.gateway.id, text, {}, 'steer').id
        await new Promise(resolve => setImmediate(resolve))
      }
      yield* textResponse('done')
    }
    await ask(app.gateway, 'Qwen 的报告')
    assert.ok(childId)
    assert.equal(app.ctx.theone.store.route(childId)?.decision.contextId, conflict ? A : B)
    assert.equal(app.ctx.theone.store.route(childId)?.status, 'completed')
    assert.equal(delivered.filter(d => d.text === text).length, 1)
    assert.equal(delivered.find(d => d.text === text)?.topicId, conflict ? A : B)
    const worker = app.ctx.theone.store.contexts().find(t => t.id === (conflict ? A : B))!.workingSessionId
    assert.ok(app.ctx.theone.store.learningJournal.turns(worker).some(t => t.source.messageId === childId && t.sources.some(s => s.messageId === 'wait-parent')))
  } finally { await app.dispose() }
})

test('temporary returns survive a restart without reviving expired pending waits', async () => {
  const app = await setup()
  let reopened: Awaited<ReturnType<typeof harness>> | undefined
  try {
    await ask(app.gateway, 'Qwen 的报告')
    await send(app, {}, '17 * 23?')
    record(app, 'expired', B, 'question')
    await app.close()
    reopened = await harness(app.root, app.model, { routerMode: 'llm' })
    const result = await ask(reopened.gateway, '继续')
    assert.equal(reopened.ctx.theone.store.route(result.input.id)?.decision.contextId, A)
    assert.equal(reopened.ctx.theone.store.routeReceipt(result.input.id)?.calls, 0)
  } finally { await (reopened?.close() ?? app.close()); await rm(app.root, { recursive: true, force: true }) }
})

test('semantic routing includes a pending owner outside the first sixteen lexical candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-state-catalog-'))
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) { yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: A, reason: 'fixture' })); return }
    yield* textResponse('done')
  }
  const app = await harness(root, model, { routerMode: 'llm', historyCatalog: true })
  try {
    await app.ctx.theone.catalog!.close()
    const topics = Array.from({ length: 24 }, (_, i) => ({ id: 'state-' + i.toString().padStart(2, '0'), title: 'Other ' + i,
      summary: 'Other project', entities: [], keywords: [], lastState: 'waiting' }))
    app.ctx.theone.store.seed(topics)
    app.ctx.theone.store.mount('test-gateway', A)
    for (const [id, topicId, kind] of [['front', A, 'reply'], ['q', 'state-23', 'question']] as const)
      app.ctx.theone.bindings.record({ id, topicId, kind, sessionId: app.gateway.id, source: 'foreground', sources: [] })
    await ask(app.gateway, '继续')
    const calls = model.requests.filter(r => r.system?.startsWith(ROUTING_PROMPT))
    const payload = JSON.parse(calls[0].messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
    assert.ok(payload.contexts.some((c: { id: string }) => c.id === 'state-23'))
    assert.ok(payload.contexts.length <= 16)
    assert.equal(payload.attention.pending[0].topicId, 'state-23')
    assert.equal('sources' in payload.attention, false)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('an invalidated temporary return cannot force a route or contaminate new model learning', async () => {
  const app = await setup()
  try {
    const parent = await send(app, {}, 'Qwen 当前进度')
    await send(app, {}, '17 * 23?')
    app.ctx.theone.store.learningJournal.move(parent.messageId, B)
    app.model.requests.length = 0
    const result = await send(app, {}, 'continue')
    assert.ok(routingCalls(app).length > 0)
    const store = app.ctx.theone.store
    const worker = store.contexts().find(t => t.id === result.route?.decision.contextId)!.workingSessionId
    const sources = store.learningJournal.turns(worker).find(t => t.source.messageId === result.messageId)!.sources
    assert.equal(store.learningJournal.valid(sources), true)
  } finally { await app.dispose() }
})
