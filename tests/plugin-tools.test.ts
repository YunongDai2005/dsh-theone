import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Compaction from '@deepseek-ai/dsh-compaction-basic'
import { harness, ask, textResponse } from './harness.ts'

function* toolCall(name: string, args: object): Generator<StreamChunk> {
  const id = ToolCallId(`call-${name}`)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

test('history tool is visible only to owned Workers, clips output and cannot select another Context', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-scoped-tools-'))
  const app = await harness(root)
  try {
    app.model.behavior = async function* () { yield* textResponse('private_marker ' + 'a'.repeat(18000)) }
    await ask(app.gateway, 'Qwen 那个')
    app.model.behavior = undefined
    await ask(app.gateway, '论文那个')
    const a = app.ctx.agents.get(SessionId(app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!.workingSessionId))!
    const b = app.ctx.agents.get(SessionId(app.ctx.theone.store.contexts().find(c => c.id === 'ctx_thesis')!.workingSessionId))!
    assert.equal(app.ctx.tools.get('theone_search_history', app.gateway), undefined)
    assert.equal(app.ctx.tools.get('theone_search_history'), undefined)
    assert.ok(app.ctx.tools.get('theone_search_history', a))
    const execute = (agent: typeof a, args: object) => app.ctx.tools.execute({ agent, name: 'theone_search_history', callId: ToolCallId('search'), arguments: args, signal: new AbortController().signal })
    const denied = await execute(app.gateway, { query: 'private_marker' })
    assert.equal(denied.isError, true)
    const own = await execute(a, { query: 'private_marker', limit: 10 })
    assert.equal(own.isError, false, JSON.stringify(own))
    const value = JSON.parse(String(own.value))
    assert.equal(value.contextId, 'ctx_qwen_9070xt')
    assert.equal(value.referenceOnly, true)
    assert.equal(value.truncated, true)
    assert.ok(value.windows.flatMap((w: { excerpts: { text: string }[] }) => w.excerpts).reduce((n: number, e: { text: string }) => n + e.text.length, 0) <= 8000)
    const other = await execute(b, { query: 'private_marker', contextId: 'ctx_qwen_9070xt' })
    assert.equal(other.isError, false)
    assert.deepEqual(JSON.parse(String(other.value)).windows, [])
    assert.equal((await execute(a, { query: 'private_marker', limit: 0 })).isError, true)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('model calls progress tool; identity and evidence survive a complete restart', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-state-tool-'))
  let app = await harness(root)
  try {
    let step = 0
    app.model.behavior = async function* (options) {
      assert.ok(options.tools?.some(tool => tool.name === 'theone_update_state'))
      if (step++ === 0) yield* toolCall('theone_update_state', { state: '已确认 ROCm 配置；下一步检查显存占用。' })
      else yield* textResponse('已保存进展。')
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.end?.data.reason.kind, 'completed', JSON.stringify(result.end))
    assert.equal(result.output, '已保存进展。')
    const before = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!
    assert.equal(before.lastState, '已确认 ROCm 配置；下一步检查显存占用。')
    const updates = app.ctx.theone.store.stateUpdates(before.id)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].sessionId, before.workingSessionId)
    const evidence = await app.ctx.sessionQuery.readSession(SessionId(before.workingSessionId))
    assert.ok(evidence.events.some(event => event.seq === updates[0].throughSeq))
    assert.throws(() => app.ctx.theone.store.updateState(before.id, 'wrong', 'another-worker', 1), /owned Worker/)
    assert.throws(() => app.ctx.theone.store.updateState(before.id, 'a'.repeat(801), before.workingSessionId, 1), /Invalid/)
    assert.throws(() => app.ctx.theone.store.updateState(before.id, 'api_key: example-secret', before.workingSessionId, 1), /credentials/)
    await app.close()
    app = await harness(root)
    const after = app.ctx.theone.store.contexts().find(c => c.id === before.id)!
    assert.equal(after.title, before.title)
    assert.equal(after.summary, before.summary)
    assert.equal(after.lastState, before.lastState)
    assert.equal(app.ctx.theone.store.stateUpdates(before.id).length, 1)
    await ask(app.gateway, '继续')
    const descriptor = app.model.requests[0].messages.findLast(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context')!
    assert.match(JSON.stringify(descriptor), /下一步检查显存占用/)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('reuse a real DSH compaction checkpoint, redact credentials, and keep its source reference', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-compaction-'))
  const app = await harness(root)
  try {
    app.model.behavior = async function* () { yield* textResponse('已完成 ROCm 配置。'.repeat(300)) }
    await ask(app.gateway, 'Qwen 那个，测试参考资料：' + '显卡配置记录。'.repeat(300))
    await ask(app.gateway, '继续')
    const context = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!
    const worker = app.ctx.agents.get(SessionId(context.workingSessionId))!
    await app.ctx.plugin(TokenMeter)
    await app.ctx.plugin(Compaction, { auto: false })
    app.model.behavior = async function* () { yield* textResponse('Qwen：ROCm 已配置，下一步检查显存。api_key: example-secret') }
    const checkpoint = await app.ctx.compaction.compactNow(worker, new AbortController().signal)
    assert.ok(checkpoint, 'DSH did not find a useful checkpoint range')
    app.model.behavior = undefined
    await ask(app.gateway, '继续')
    const after = app.ctx.theone.store.contexts().find(c => c.id === context.id)!
    assert.equal(after.title, context.title)
    assert.equal(after.lastState, context.lastState)
    assert.match(after.summary, /ROCm 已配置/)
    assert.ok(!after.summary.includes('example-secret'))
    assert.match(after.summary, /REDACTED/)
    const updates = app.ctx.theone.store.summaryUpdates(context.id)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].summarySeq, checkpoint.summarySeq)
    assert.equal(updates[0].endSeq, checkpoint.endSeq)
    await ask(app.gateway, '继续')
    assert.equal(app.ctx.theone.store.summaryUpdates(context.id).length, 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
