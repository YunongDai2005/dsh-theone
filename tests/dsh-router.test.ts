import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshRouter, RouterFailure, ROUTING_PROMPT } from '../src/llm-router.ts'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

const context = { id: 'ctx_qwen_9070xt', title: 'Qwen', summary: '配置', entities: [], keywords: [], lastState: '检查' }
const input = { text: '继续配置', contexts: [context] }
const decision = { action: 'EXISTING', contextId: context.id, title: null, question: null, reason: '继续配置' }

test('DSH router uses its configured adapter without a separate key or session/tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-dsh-native-'))
  const app = await harness(root)
  try {
    app.model.behavior = async function* (options) {
      assert.equal(options.provider, 'fixture')
      assert.equal(options.model, 'custom-model')
      assert.equal(options.tools, undefined)
      assert.equal(options.sessionId, undefined)
      assert.equal(options.system, ROUTING_PROMPT)
      assert.equal(options.messages.length, 1)
      assert.ok(!JSON.stringify(options.messages).includes('sk-syntheticsecret012345678901'))
      yield* textResponse('```json\n' + JSON.stringify(decision) + '\n```')
    }
    const router = new DshRouter(app.ctx.llm, () => ({ provider: 'fixture', model: 'custom-model' }))
    const result = await router.decide({ ...input, text: '继续 sk-syntheticsecret012345678901' })
    assert.equal(result.decision.action, 'MOUNT')
    assert.equal(result.model, 'custom-model')
    assert.equal(app.model.requests.length, 1)
    assert.equal(app.gateway.session.snapshotEvents().filter(e => e.type === 'assistant/message').length, 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('routing disables supported deep thinking without changing Worker or provider defaults', async () => {
  class ReasoningModel extends FixtureModel {
    override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return {provider,id:model,name:model,reasoning:{efforts:[{id:ReasoningEffortId('off'),name:'Off'},{id:ReasoningEffortId('high'),name:'High'}],defaultEffort:ReasoningEffortId('high')}}
    }
  }
  const root = await mkdtemp(join(tmpdir(),'theone-router-thinking-'))
  const model = new ReasoningModel()
  model.behavior = async function* (options) {
    if (options.system === ROUTING_PROMPT) {
      assert.equal(options.reasoningEffort,'off')
      assert.equal(options.maxTokens,2048)
      yield* textResponse(JSON.stringify(decision))
    } else {
      assert.equal(options.reasoningEffort,'high')
      yield* textResponse('Worker keeps user model defaults')
    }
  }
  const app = await harness(root,model,{routerMode:'llm',routerTransport:'dsh'})
  try {
    assert.equal((await ask(app.gateway,'继续 Qwen 配置')).output,'Worker keeps user model defaults')
    assert.equal((await app.ctx.llm.resolveModelInfo('fixture','fixture')).reasoning?.defaultEffort,'high')
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

test('native routing and Worker share DSH model; gateway selection persists through restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-dsh-selection-'))
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    yield* textResponse(options.system === ROUTING_PROMPT ? JSON.stringify(decision) : '工作继续')
  }
  let app = await harness(root, model, { routerMode: 'llm', routerTransport: 'dsh', autoModel: true })
  const setDefault = (value: ReturnType<typeof app.ctx.agentDefaultModel.currentSelection>) => {
    app.ctx.agentDefaultModel.currentSelection = () => value
  }
  try {
    setDefault({ provider: 'fixture', model: 'user-configured-model' })
    await app.ctx.llm.resolveCallConfig({ provider: 'theone', model: 'gateway' })
    setDefault({ provider: 'theone', model: 'gateway' })
    const first = await ask(app.gateway, '继续 Qwen 配置')
    assert.equal(first.output, '工作继续', JSON.stringify(first.end))
    assert.equal(app.ctx.theone.store.route(first.input.id)?.decision.action, 'MOUNT')
    assert.deepEqual(model.requests.map(r => [r.provider, r.model]), [['fixture', 'user-configured-model'], ['fixture', 'user-configured-model']])
    assert.equal(app.ctx.theone.store.rememberedModel('test-gateway')?.model, 'user-configured-model')
    await app.close()
    model.requests = []
    app = await harness(root, model, { routerMode: 'llm', routerTransport: 'dsh', autoModel: true, defaultProvider: 'theone' })
    const second = await ask(app.gateway, '继续配置')
    assert.equal(second.output, '工作继续')
    assert.equal(app.ctx.theone.store.route(second.input.id)?.decision.action, 'KEEP')
    assert.ok(model.requests.every(r => r.model === 'user-configured-model'))
    setDefault({ provider: 'fixture', model: 'new-model' })
    await app.ctx.llm.resolveCallConfig({ provider: 'theone', model: 'gateway' })
    setDefault({ provider: 'theone', model: 'gateway' })
    model.requests = []
    assert.equal((await ask(app.gateway, '继续配置')).output, '工作继续')
    assert.ok(model.requests.every(r => r.model === 'new-model'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('native routing rejects invalid or truncated results, and cools down authentication failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-dsh-failures-'))
  const app = await harness(root)
  try {
    for (const kind of ['unknown', 'truncated', 'no-finish', 'large']) {
      app.model.behavior = async function* () {
        if (kind === 'no-finish') return
        if (kind === 'truncated') { yield { type: 'finish', reason: { kind: 'max-tokens' } }; return }
        yield* textResponse(kind === 'large' ? 'x'.repeat(8193) : JSON.stringify({ ...decision, contextId: 'missing' }))
      }
      await assert.rejects(new DshRouter(app.ctx.llm, () => ({ provider: 'fixture', model: 'fixture' })).decide(input), RouterFailure)
    }
    app.model.behavior = async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'private error text', code: 'AUTH_FAILED', status: 401 } } }
    }
    const router = new DshRouter(app.ctx.llm, () => ({ provider: 'fixture', model: 'fixture' }))
    await assert.rejects(router.decide(input), e => e instanceof RouterFailure && e.meta?.httpStatus === 401 && !e.message.includes('private'))
    const count = app.model.requests.length
    await assert.rejects(router.decide(input), e => e instanceof RouterFailure && e.code === 'ROUTER_CIRCUIT_OPEN')
    assert.equal(app.model.requests.length, count)
    await assert.rejects(new DshRouter(app.ctx.llm, () => ({ provider: 'theone', model: 'gateway' })).decide(input), e => e instanceof RouterFailure && e.code === 'ROUTER_RECURSION_BLOCKED')
    assert.equal(app.model.requests.length, count)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('native routing cancellation preserves mount and never starts a Worker', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-dsh-cancel-'))
  const app = await harness(root, undefined, { routerMode: 'llm', routerTransport: 'dsh', autoModel: true })
  try {
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    app.model.behavior = async function* (options) {
      entered()
      await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }))
      options.signal!.throwIfAborted()
    }
    const running = ask(app.gateway, '继续配置')
    await started
    app.gateway.cancel({ kind: 'user' })
    await running
    assert.equal(app.ctx.theone.store.current('test-gateway'), undefined)
    assert.equal(app.model.requests.length, 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('missing backing model asks for DSH selection without dispatching or changing state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-dsh-missing-'))
  const app = await harness(root, undefined, { routerMode: 'llm', routerTransport: 'dsh', autoModel: true, defaultProvider: 'theone' })
  try {
    const result = await ask(app.gateway, '继续配置')
    assert.match(result.output, /DSH.*聊天模型/, JSON.stringify(result.end))
    assert.equal(app.ctx.theone.store.current('test-gateway'), undefined)
    assert.equal(app.model.requests.length, 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
