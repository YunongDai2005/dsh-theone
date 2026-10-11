import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness, ask } from './harness.ts'

test('a new main chat opens with a welcome turn, so DSH does not treat it as blank and lock its input', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-welcome-'))
  const app = await harness(root)
  try {
    const gateway = app.gateway
    app.ctx.theone.store.rememberGateway('test-gateway', gateway.id)
    app.ctx.theone.welcomeGateway(gateway.id, 'zh-CN')
    await gateway.whenIdle()
    const events = gateway.session.snapshotEvents()
    assert.ok(events.some(event => event.type === 'turn/start'))
    const replies = events.flatMap(event => event.type === 'assistant/message' ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : [])
    assert.equal(replies.length, 1)
    assert.match(replies[0], /^你好/)
    // No model was called and nothing was routed.
    assert.equal(app.model.requests.length, 0)
    assert.equal(app.ctx.theone.store.current('test-gateway'), undefined)
    // Only once.
    app.ctx.theone.welcomeGateway(gateway.id, 'en-US')
    await gateway.whenIdle()
    assert.equal(gateway.session.snapshotEvents().filter(event => event.type === 'turn/start').length, 1)
    // The chat carries on normally afterwards.
    assert.equal((await ask(gateway, 'Qwen 的配置')).output, '模拟回答：ctx_qwen_9070xt')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
