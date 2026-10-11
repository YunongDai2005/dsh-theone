import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { harness, ask, textResponse } from './harness.ts'

/** A message carrying only a file, as DSH stores an attachment sent without words. */
async function sendFile(agent: Awaited<ReturnType<typeof harness>>['gateway'], name: string) {
  const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: { attachmentId: `att_${randomUUID()}`, name, bytes: 12 } }] } as never) as UserMessage
  agent.followup(input)
  await agent.whenIdle()
  return input
}

test('a file sent without words stays with the current topic, or starts one named after it', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-attachment-'))
  const app = await harness(root, undefined, { routerMode: 'llm' })
  try {
    app.model.behavior = async function* (options) {
      // No words to classify: routing must not call the model for an attachment.
      assert.notEqual(options.system, ROUTING_PROMPT)
      yield* textResponse('收到附件')
    }
    const first = await sendFile(app.gateway, '预算表.xlsx')
    const created = app.ctx.theone.store.route(first.id)?.decision
    assert.equal(created?.action, 'CREATE')
    assert.equal(created?.title, '预算表.xlsx')
    const current = app.ctx.theone.store.current('test-gateway')
    assert.ok(current)
    const second = await sendFile(app.gateway, '截图.png')
    const kept = app.ctx.theone.store.route(second.id)?.decision
    assert.equal(kept?.action, 'KEEP')
    assert.equal(kept?.contextId, current)
    assert.equal(kept?.reason, 'attachment-only')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('when the classifier fails, rules route the message and stay with the current topic when unsure', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-router-fallback-'))
  const app = await harness(root, undefined, { routerMode: 'llm' })
  try {
    app.model.behavior = async function* (options) {
      if (options.system === ROUTING_PROMPT) { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'down', status: 500 } } }; return }
      yield* textResponse('继续处理')
    }
    // A clear rule match is taken even without the classifier.
    const mounted = await ask(app.gateway, 'Qwen 的 ROCm 配置')
    assert.equal(mounted.output, '继续处理')
    const route = app.ctx.theone.store.route(mounted.input.id)?.decision
    assert.equal(route?.action, 'MOUNT')
    assert.equal(route?.contextId, 'ctx_qwen_9070xt')
    assert.equal(route?.reason, 'router-fallback:ROUTER_REQUEST_FAILED')
    // An unclear message is not a question back: it continues the current topic.
    const unsure = await ask(app.gateway, '这个周末再看看效果')
    assert.equal(unsure.output, '继续处理')
    const kept = app.ctx.theone.store.route(unsure.input.id)?.decision
    assert.equal(kept?.action, 'KEEP')
    assert.equal(kept?.contextId, 'ctx_qwen_9070xt')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a model picked in main chat classifies the very message it was picked for', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-picked-now-'))
  const app = await harness(root, undefined, { routerMode: 'llm', autoModel: true })
  try {
    app.model.behavior = async function* (options) {
      if (options.system === ROUTING_PROMPT) {
        yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: 'ctx_qwen_9070xt', title: null, question: null, reason: '测试' }))
        return
      }
      yield* textResponse('好')
    }
    const picked = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'fixture', model: 'picked-model' } })).agent
    app.ctx.theone.store.rememberGateway('test-gateway', picked.id)
    assert.equal((await ask(picked, 'Qwen 那个')).output, '好')
    assert.deepEqual(app.model.requests.map(request => request.model), ['picked-model', 'picked-model'])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a shortened topic descriptor is still valid JSON', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-descriptor-'))
  const descriptorPath = join(root, 'topics.json')
  await writeFile(descriptorPath, JSON.stringify([{ id: 'ctx_qwen_9070xt', title: 'Qwen "配置"', summary: '很长的摘要，带 "引号" 和 \\ 反斜杠。'.repeat(40),
    entities: ['Qwen'], keywords: ['Qwen'], lastState: '进行中'.repeat(30) }]))
  const app = await harness(root, undefined, { descriptorPath, theoneConfig: { maxDescriptorChars: 128 } })
  try {
    let descriptor: unknown
    app.model.behavior = async function* (options) {
      const message = options.messages.find(item => 'source' in item && item.source?.kind === 'theone-context')
      const text = message && 'content' in message ? (message.content as { type: string; text?: string }[]).map(block => block.text ?? '').join('') : ''
      descriptor = JSON.parse(text.slice(text.indexOf('\n') + 1))
      yield* textResponse('好')
    }
    assert.equal((await ask(app.gateway, 'Qwen 的配置')).output, '好')
    const value = descriptor as { title: string; summary: string; lastState: string }
    assert.ok(value.summary.endsWith('…'))
    assert.ok(JSON.stringify(value).length <= 128 + 64)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
