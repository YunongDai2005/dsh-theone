import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness, ask } from './harness.ts'

test('DSH: single gateway → Qwen → thesis → Qwen, then gateway rebuild', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-demo-'))
  let app = await harness(root)
  try {
    for (const [input, expected, action] of [
      ['Qwen 后来怎么解决的？', 'ctx_qwen_9070xt', 'MOUNT'],
      ['不是这个，是论文那个', 'ctx_thesis', 'SWAP'],
      ['回到 Qwen 那个', 'ctx_qwen_9070xt', 'SWAP'],
    ]) {
      const answer = await ask(app.gateway, input)
      assert.equal(answer.end?.data.reason.kind, 'completed', JSON.stringify(answer.end))
      assert.equal(answer.output, `模拟回答：${expected}`)
      assert.equal(app.ctx.theone.store.route(answer.input.id)?.decision.action, action)
      console.log(`${input} → ${action} → ${answer.output}`)
    }
    assert.equal(app.model.requests.length, 3)
    const [qwen, thesis, qwenAgain] = app.model.requests
    assert.equal(qwen.sessionId, qwenAgain.sessionId)
    assert.notEqual(qwen.sessionId, thesis.sessionId)
    // Another topic reaches a Worker only as the marked cross-topic reference, never as its own history.
    const own = (messages: typeof thesis.messages) => JSON.stringify(messages.filter(m => !('source' in m) || m.source?.kind !== 'theone-links'))
    assert.ok(!own(thesis.messages).includes('ctx_qwen_9070xt'))
    assert.ok(!own(qwenAgain.messages).includes('ctx_thesis'))
    assert.ok(thesis.messages.some(m => 'source' in m && m.source?.kind === 'theone-links'))
    const workerId = qwen.sessionId
    await app.close()
    app = await harness(root)
    const resumed = await ask(app.gateway, '继续')
    assert.equal(resumed.output, '模拟回答：ctx_qwen_9070xt')
    assert.equal(app.model.requests[0].sessionId, workerId)
    assert.equal(app.ctx.theone.store.route(resumed.input.id)?.decision.action, 'KEEP')
    assert.ok(app.model.requests[0].messages.some(message => message.role === 'assistant'))
    console.log('重建 Gateway → KEEP → 恢复同一个持久化 Working Session')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
