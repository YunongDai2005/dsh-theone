import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harness, ask, textResponse } from './harness.ts'

function* call(id: string, name: string, args = '{}'): Generator<StreamChunk> {
  const callId = ToolCallId(id)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: args } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
const userText = (messages: readonly { role: string; content: readonly { type: string; text?: string }[] }[]) =>
  messages.filter(m => m.role === 'user').map(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('')).join('\n')

test('steering during a Worker tool reaches its next step and appears between the steps, as in a native session', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mirror-steer-'))
  const app = await harness(root)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  let calls = 0
  const requests: string[] = []
  try {
    app.ctx.tools.register(defineTool({ name: 'slow_build', description: 'Synthetic slow tool', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async () => { calls++; entered.resolve(); await release.promise; return 'built' } }))
    app.model.behavior = async function* (options) {
      requests.push(userText(options.messages))
      if (!calls) yield* call('build-call', 'slow_build')
      else yield* textResponse('按 14B 处理好了')
    }
    const pending = ask(app.gateway, 'Qwen 那个')
    await entered.promise
    app.gateway.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '改成 14B' }] }))
    await new Promise(resolve => setTimeout(resolve, 20))
    release.resolve()
    const result = await pending
    assert.equal(result.end?.data.reason.kind, 'completed', JSON.stringify(result.end))
    assert.equal(calls, 1)
    assert.match(requests[1], /改成 14B/)
    const order = result.events.flatMap(e => e.type === 'assistant/message' ? ['assistant'] : e.type === 'tool/result' ? ['tool'] :
      e.type === 'user/message' && e.data.source.kind === 'user' ? ['user'] : [])
    assert.deepEqual(order, ['user', 'assistant', 'tool', 'user', 'assistant'])
    assert.equal(result.output, '按 14B 处理好了')
    // Steering stayed in the same topic without another routing decision.
    assert.equal(result.events.filter(e => e.type === 'user/message' && e.data.source.kind === 'theone-route').length, 1)
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('main-chat tool cards bypass hooks and policy; only the Worker runs the tool, with the same result', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mirror-policy-'))
  const app = await harness(root)
  let bodies = 0
  const hooked: string[] = []
  try {
    // Stand-ins for user hooks, permission policy and around-dispatch wrappers.
    app.ctx.on('tools/pre-execute', async (exec, next) => { hooked.push(`pre:${exec.agent?.id === app.gateway.id ? 'gateway' : 'worker'}`); return next() })
    app.ctx.on('tools/post-execute', async (exec, _result, next) => { hooked.push(`post:${exec.agent?.id === app.gateway.id ? 'gateway' : 'worker'}`); return next() })
    app.ctx.tools.register(defineTool({ name: 'write_note', description: 'Synthetic side effect', parameters: { text: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async ({ text }) => { bodies++; return `saved ${text}` } }))
    let step = 0
    app.model.behavior = async function* () {
      if (step++ === 0) yield* call('note-call', 'write_note', '{"text":"hello"}')
      else yield* textResponse('完成')
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.output, '完成')
    assert.equal(bodies, 1)
    assert.deepEqual(hooked, ['pre:worker', 'post:worker'])
    const shown = result.events.find(e => e.type === 'tool/result')
    assert.ok(shown?.type === 'tool/result' && JSON.stringify(shown.data).includes('saved hello'), JSON.stringify(shown))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test("TheOne's own Worker tools and todo lists show in the main chat", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mirror-own-'))
  const app = await harness(root)
  try {
    app.ctx.tools.register(defineTool({ name: 'plan_todos', description: 'Synthetic todo writer', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        (exec.agent!.session as unknown as { append(type: string, data: unknown): void }).append('todo/write', { todos: [{ content: '配置 Qwen', status: 'in_progress' }] })
        return 'planned'
      } }))
    let step = 0
    app.model.behavior = async function* () {
      if (step === 0) { step++; yield* call('state-call', 'theone_update_state', '{"state":"已确认显卡型号"}') }
      else if (step === 1) { step++; yield* call('todo-call', 'plan_todos') }
      else yield* textResponse('记下了')
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.output, '记下了')
    const results = result.events.filter(e => e.type === 'tool/result')
    assert.equal(results.length, 2)
    assert.ok(results.every(e => e.type === 'tool/result' && !JSON.stringify(e.data).includes('UNKNOWN_TOOL')), JSON.stringify(results))
    assert.ok(JSON.stringify(results[0]).includes('Project progress saved.'))
    assert.ok(result.events.some(e => (e as { type: string }).type === 'todo/write'))
    assert.equal(app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')?.lastState, '已确认显卡型号')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a provider that reuses tool call ids across steps still shows each step its own result', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mirror-ids-'))
  const app = await harness(root)
  let runs = 0
  try {
    app.ctx.tools.register(defineTool({ name: 'counter', description: 'Synthetic counter', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async () => `run ${++runs}` }))
    let step = 0
    app.model.behavior = async function* () {
      if (step++ < 2) yield* call('call_0', 'counter')
      else yield* textResponse('数完了')
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.output, '数完了')
    assert.equal(runs, 2)
    const shown = result.events.flatMap(e => e.type === 'tool/result' ? [JSON.stringify(e.data)] : [])
    assert.equal(shown.length, 2)
    assert.ok(shown[0].includes('run 1') && shown[1].includes('run 2'), JSON.stringify(shown))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
