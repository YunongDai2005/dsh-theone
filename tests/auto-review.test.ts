import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ask } from './harness.ts'
import { setupAutoReview as setup } from './auto-review-harness.ts'

test('Auto review carries the topic session identity and does not review mirrored calls again', { timeout: 30000 }, async () => {
  const app = await setup()
  try {
    const result = await ask(app.gateway, 'Qwen 那个')
    const topic = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!
    assert.equal(app.reviews.length, 1)
    assert.equal(app.reviews[0].sessionId, topic.workingSessionId)
    assert.equal(app.bodies(), 1)
    assert.match(result.output, /PROBE_EXECUTED/)
    assert.equal(result.events.filter(e => e.type === 'tool/result' && e.data.message.isError).length, 0)
    assert.doesNotMatch(JSON.stringify(result.events), /missing or ambiguous|MissingSessionID/)
    app.repeat()
    const again = await ask(app.gateway, '继续')
    assert.equal(app.bodies(), 2)
    assert.equal(app.reviews.length, 2)
    assert.equal(app.reviews[1].sessionId, topic.workingSessionId)
    assert.equal(again.events.filter(e => e.type === 'tool/result' && e.data.message.isError).length, 0)
  } finally { await app.close() }
})

test('an upstream-supplied review identity is preserved', { timeout: 30000 }, async () => {
  const app = await setup()
  try {
    const supplied = SessionId('upstream-review-session')
    app.ctx.on('llm/stream', (options, next) => {
      if (typeof options.system === 'string' && options.system.startsWith('REVIEW_POLICY\n') && !options.sessionId)
        return app.ctx.llm.stream({ ...options, sessionId: supplied })
      return next()
    }, { prepend: true })
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(app.reviews.length, 1)
    assert.equal(app.reviews[0].sessionId, supplied)
    assert.equal(app.bodies(), 1)
    assert.equal(result.events.filter(e => e.type === 'tool/result' && e.data.message.isError).length, 0)
  } finally { await app.close() }
})

for (const answer of ['allowed-once', 'rejected'] as const) {
  test(`Auto denial still asks on the main-chat card and honors ${answer}`, { timeout: 30000 }, async () => {
    const app = await setup()
    try {
      app.verdict('{"risk":"medium","decision":"deny","reason":"Confirm this action"}')
      const asked: string[] = []
      app.ctx.on('approval/request', async (request, next) => {
        if (request.agent !== app.gateway) return next()
        asked.push(request.callId!)
        return answer
      })
      const result = await ask(app.gateway, 'Qwen 那个')
      const call = result.events.find(e => e.type === 'tool/call')!
      assert.equal(call.type, 'tool/call')
      if (call.type === 'tool/call') assert.deepEqual(asked, [call.data.callId])
      assert.equal(app.reviews.length, 1)
      assert.equal(app.bodies(), answer === 'allowed-once' ? 1 : 0)
      assert.equal(result.events.filter(e => e.type === 'tool/result' && e.data.message.isError).length, answer === 'allowed-once' ? 0 : 1)
      assert.doesNotMatch(JSON.stringify(result.events), /missing or ambiguous|MissingSessionID/)
    } finally { await app.close() }
  })
}

test('a malformed Auto review still prevents the real tool body from running', { timeout: 30000 }, async () => {
  const app = await setup()
  try {
    app.verdict('not a review decision')
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(app.reviews.length, 1)
    assert.equal(app.bodies(), 0)
    assert.equal(result.events.filter(e => e.type === 'tool/result' && e.data.message.isError).length, 1)
    assert.match(result.output, /Auto review.*failed/)
  } finally { await app.close() }
})

test('concurrent native review does not borrow the topic session identity', { timeout: 30000 }, async () => {
  const app = await setup()
  try {
    const native = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: app.root } })).agent
    app.ctx.permissionPresets.set(native.session, 'auto')
    const [mainResult, nativeResult] = await Promise.all([ask(app.gateway, 'Qwen 那个'), ask(native, 'Run the probe')])
    const topic = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!
    assert.deepEqual(new Set(app.reviews.map(request => request.sessionId)), new Set([undefined, topic.workingSessionId]))
    assert.equal(app.bodies(), 1)
    assert.match(mainResult.output, /PROBE_EXECUTED/)
    assert.match(nativeResult.output, /MissingSessionID/)
  } finally { await app.close() }
})

test('Auto reviews worker-only tools once even when the provider accepts no session identity', { timeout: 30000 }, async () => {
  const app = await setup()
  try {
    app.requireSession(false)
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(app.bodies(), 1)
    assert.doesNotMatch(JSON.stringify(result.events), /pending native tool schema is missing or ambiguous/)
    assert.equal(app.reviews.length, 1)
  } finally { await app.close() }
})

test('native DSH Auto review control exposes the upstream missing session identity', { timeout: 30000 }, async () => {
  const app = await setup()
  try {
    const native = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: app.root } })).agent
    app.ctx.permissionPresets.set(native.session, 'auto')
    const result = await ask(native, 'Run the probe')
    assert.equal(app.reviews.length, 1)
    assert.equal(app.reviews[0].sessionId, undefined)
    assert.equal(app.bodies(), 0)
    assert.match(result.output, /MissingSessionID/)
  } finally { await app.close() }
})
