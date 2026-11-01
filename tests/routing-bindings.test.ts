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

test('a bound route still checks another project before executing a write', async () => {
  const app = await setup()
  let edits = 0, checks = 0
  try {
    record(app, 'ref', B)
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
    const result = await send(app, { replyTo: 'ref' })
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
