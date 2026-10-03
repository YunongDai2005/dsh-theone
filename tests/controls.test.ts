import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ReasoningEffortId, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

class VisionReasoningModel extends FixtureModel {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, inputModalities: ['text', 'image'],
      reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }, { id: ReasoningEffortId('high'), name: 'High' }], defaultEffort: ReasoningEffortId('high') } }
  }
}

test('main chat accepts images and offers thinking efforts exactly when the backing model does', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-controls-info-'))
  const app = await harness(root, new VisionReasoningModel())
  try {
    const info = await app.ctx.llm.resolveModelInfo('theone', 'gateway')
    assert.deepEqual(info.inputModalities, ['text', 'image'])
    assert.deepEqual(info.reasoning?.efforts.map(effort => effort.id), ['off', 'high'])
    const listed = await app.ctx.llm.listModels('theone')
    assert.deepEqual(listed[0].inputModalities, ['text', 'image'])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('the thinking effort chosen in main chat is the one the Worker uses', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-controls-effort-'))
  const model = new VisionReasoningModel()
  model.behavior = async function* () { yield* textResponse('好') }
  const app = await harness(root, model)
  try {
    const chosen = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'theone', model: 'gateway', reasoningEffort: ReasoningEffortId('off') } })).agent
    assert.equal((await ask(chosen, 'Qwen 那个')).output, '好')
    assert.equal(model.requests.at(-1)?.reasoningEffort, 'off')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('picking another model in main chat makes the Workers use it; main chat still routes through TheOne', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-controls-picker-'))
  // A model fixed in TheOne's settings would take precedence; this follows DSH's selection.
  const app = await harness(root, undefined, { autoModel: true })
  try {
    app.model.behavior = async function* () { yield* textResponse('换了模型也照常路由') }
    const picked = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'fixture', model: 'picked-model' } })).agent
    app.ctx.theone.store.rememberGateway('test-gateway', picked.id)
    const result = await ask(picked, 'Qwen 那个')
    assert.equal(result.output, '换了模型也照常路由')
    assert.ok(result.events.some(e => e.type === 'user/message' && e.data.source.kind === 'theone-route'))
    // Only the Worker called the fixture provider, with the picked model; main chat went through TheOne.
    assert.deepEqual(app.model.requests.map(r => r.model), ['picked-model'])
    assert.ok(result.events.some(e => e.type === 'request/header' && e.data.header.config.provider === 'theone'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('the reply limit applies per step, so a long multi-step task is not cut off by its total', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-controls-limit-'))
  const app = await harness(root, undefined, { theoneConfig: { maxResponseChars: 128 } })
  try {
    let step = 0
    app.model.behavior = async function* () {
      if (step++ < 2) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'x'.repeat(100) }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'x'.repeat(100) } }
        yield { type: 'block-start', index: 1, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 1, id: `call-${step}` as never, name: 'theone_update_state', argumentsDelta: '{"state":"进行中"}' }
        yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: `call-${step}` as never, name: 'theone_update_state', arguments: '{"state":"进行中"}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('y'.repeat(100))
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.end?.data.reason.kind, 'completed', JSON.stringify(result.end))
    assert.equal(result.output.length, 300)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test("the Worker takes main chat's permission mode before each reply", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-controls-permission-'))
  const app = await harness(root)
  const modes = new Map<string, string>()
  try {
    // Stand-in for dsh-permission-presets: one preset per session.
    app.ctx.provide('permissionPresets')
    app.ctx.set('permissionPresets', {
      current: (session: { id: string }) => modes.get(session.id) ?? 'workspace-write',
      set: (session: { id: string }, name: string) => { modes.set(session.id, name) },
    })
    modes.set(app.gateway.id, 'danger-full-access')
    app.model.behavior = async function* () { yield* textResponse('好') }
    await ask(app.gateway, 'Qwen 那个')
    const workerId = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!.workingSessionId
    assert.equal(modes.get(workerId), 'danger-full-access')
    modes.set(app.gateway.id, 'custom')
    await ask(app.gateway, '继续')
    assert.equal(modes.get(workerId), 'danger-full-access')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a session that used TheOne and switched back to an ordinary model runs its own tools again', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-controls-switch-'))
  const app = await harness(root)
  const selection: ModelSelectionRef = { current: { provider: 'theone', model: 'gateway' }, assembled: undefined }
  let runs = 0
  try {
    app.ctx.tools.register(defineTool({ name: 'own_tool', description: 'Synthetic tool', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async () => `ran ${++runs}` }))
    const handle = await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'fixture' },
      setup: agentCtx => { installModelSelection(agentCtx, selection) } })
    app.model.behavior = async function* () { yield* textResponse('经由 TheOne') }
    assert.equal((await ask(handle.agent, 'Qwen 那个')).output, '经由 TheOne')
    assert.ok(app.ctx.theone.store.isGateway(handle.agent.id))
    selection.current = { provider: 'fixture', model: 'fixture' }
    let step = 0
    app.model.behavior = async function* () {
      if (step++ === 0) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'own-call' as never, name: 'own_tool', argumentsDelta: '{}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'own-call' as never, name: 'own_tool', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('普通会话自己执行了工具')
    }
    const ordinary = await ask(handle.agent, '普通会话')
    assert.equal(ordinary.output, '普通会话自己执行了工具')
    assert.equal(runs, 1)
    assert.equal(app.ctx.theone.store.route(ordinary.input.id), undefined)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('main chat lists "TheOne · <model>" for every model; picking one routes and works with it', { timeout: 30000 }, async () => {
  class ListedModel extends VisionReasoningModel {
    override async listModels(provider: string) {
      return [{ provider, id: 'fixture', name: 'Fixture' }, { provider, id: 'fixture-b', name: 'Fixture B', inputModalities: ['text' as const] }]
    }
  }
  const root = await mkdtemp(join(tmpdir(), 'theone-controls-via-'))
  const model = new ListedModel()
  model.behavior = async function* (options) {
    yield* textResponse(options.system === ROUTING_PROMPT
      ? JSON.stringify({ action: 'EXISTING', contextId: 'ctx_qwen_9070xt', title: null, question: null, reason: '测试' }) : '好')
  }
  const app = await harness(root, model, { routerMode: 'llm', autoModel: true })
  try {
    const listed = await app.ctx.llm.listModels('theone')
    assert.deepEqual(listed.map(entry => [entry.id, entry.name]), [
      ['gateway', 'TheOne'], ['via:fixture/fixture', 'TheOne · Fixture'], ['via:fixture/fixture-b', 'TheOne · Fixture B']])
    const info = await app.ctx.llm.resolveModelInfo('theone', 'via:fixture/fixture-b')
    assert.equal(info.name, 'TheOne · fixture-b')
    assert.deepEqual(info.reasoning?.efforts.map(effort => effort.id), ['off', 'high'])
    await assert.rejects(app.ctx.llm.resolveModelInfo('theone', 'via:theone/gateway'))
    const chat = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'theone', model: 'via:fixture/fixture-b' } })).agent
    app.ctx.theone.store.rememberGateway('test-gateway', chat.id)
    assert.equal((await ask(chat, 'Qwen 那个')).output, '好')
    // Routing and the background both ran on the picked model; main chat stayed TheOne.
    assert.deepEqual(model.requests.map(request => request.model), ['fixture-b', 'fixture-b'])
    // A model pinned in TheOne's settings decides instead, so the menu offers only TheOne.
    const pinned = await harness(join(root, 'pinned'), new ListedModel())
    try { assert.deepEqual((await pinned.ctx.llm.listModels('theone')).map(entry => entry.id), ['gateway']) }
    finally { await pinned.close() }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
