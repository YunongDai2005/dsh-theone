import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { harness, FixtureModel, textResponse, peered } from './harness.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import type { BubbleView } from '../src/bubble-types.ts'
const say = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
function waitFor(app: Awaited<ReturnType<typeof harness>>, predicate: (view: BubbleView) => boolean) {
  const gate = Promise.withResolvers<void>()
  const check = () => { if (predicate(app.ctx.theone.bubbleView(app.gateway.id))) { off(); gate.resolve() } }
  const off = app.ctx.theone.bubbleActivity.subscribe(check); check(); return gate.promise
}

test('done rejects running work and ready-but-undelivered results, then succeeds after delivery', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-done-')), model = new FixtureModel()
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const text = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text).text as string
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: text.includes('thesis') ? 'ctx_thesis' : 'ctx_qwen_9070xt', reason: 'fixture' })); return
    }
    const context = options.messages.find(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context')
    if (context && 'source' in context && context.source?.kind === 'theone-context' && context.source.contextId === 'ctx_qwen_9070xt') { entered.resolve(); await gate.promise }
    yield* textResponse('answer')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never), handler = peered(connection)
    await new Promise<void>(resolve => setImmediate(resolve))
    const done = (id: string, value = true) => handler.fetch(new Request('http://dsh.internal/api/theone/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'status', id, done: value }) }))
    app.gateway.followup(say('Qwen hardware')); await entered.promise
    const rejected = await done('ctx_qwen_9070xt')
    assert.equal(rejected.status, 409); assert.deepEqual(await rejected.json(), { error: 'TOPIC_BUSY' })
    assert.equal(app.ctx.theone.store.declaredTopics().has('ctx_qwen_9070xt'), false)
    // Another idle topic is not blocked by global foreground activity.
    assert.equal((await done('ctx_thesis')).status, 200)
    assert.equal((await done('ctx_thesis', false)).status, 200)
    const input = say('thesis experiment'); app.gateway.followup(input)
    await waitFor(app, v => v.workItems.some(w => w.primaryMessageId === input.id && w.phase === 'succeeded'))
    const ready = await done('ctx_thesis')
    assert.equal(ready.status, 409); assert.deepEqual(await ready.json(), { error: 'TOPIC_BUSY' })
    assert.equal(app.ctx.theone.bubbleView(app.gateway.id).topics.find(t => t.id === 'ctx_thesis')!.capabilities.declareDone.reason, 'pending_delivery')
    gate.resolve(); await app.gateway.whenIdle()
    await waitFor(app, v => v.workItems.some(w => w.primaryMessageId === input.id && w.delivery.phase === 'shown'))
    assert.equal((await done('ctx_thesis')).status, 200)
    assert.equal(app.ctx.theone.bubbleView(app.gateway.id).topics.find(t => t.id === 'ctx_thesis')!.effectiveDone, true)
  } finally { gate.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('done is rechecked after reading the HTTP body, including a topic still starting', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-done-race-')), app = await harness(root)
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never), handler = peered(connection)
    await new Promise<void>(resolve => setImmediate(resolve))
    const body = Promise.withResolvers<unknown>(), requested = Promise.withResolvers<void>()
    const request = new Request('http://dsh.internal/api/theone/topics', { method: 'POST' })
    request.json = () => { requested.resolve(); return body.promise }
    const response = handler.fetch(request); await requested.promise
    const input = say('still preparing')
    app.ctx.theone.bubbleActivity.starting(app.gateway, input, 'ctx_thesis')
    body.resolve({ action: 'status', id: 'ctx_thesis', done: true })
    const result = await response
    assert.equal(result.status, 409); assert.deepEqual(await result.json(), { error: 'TOPIC_BUSY' })
    assert.equal(app.ctx.theone.store.declaredTopics().has('ctx_thesis'), false)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})


test('done keeps unobserved recovery and pending persisted delivery guarded without starting a Worker', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-done-recovery-')), app = await harness(root)
  try {
    const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
    await new Promise<void>(resolve => setImmediate(resolve))
    const store = app.ctx.theone.store, message = say('pending before recovery')
    store.rememberGateway('test-gateway', app.gateway.id)
    store.plan(message.id, app.gateway.id, 'test-gateway', { action: 'KEEP', contextId: 'ctx_thesis', reason: 'fixture' }, false)
    store.claim(message.id)
    store.startTopicRun(message.id, 'ctx_thesis', 'old-worker')
    store.replaceHidden([{ id: 'ctx_thesis', reason: 'archived' }])
    const done = () => handler.fetch(new Request('http://dsh.internal/api/theone/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'status', id: 'ctx_thesis', done: true }) }))
    const before = app.model.requests.length
    assert.equal((await done()).status, 409)
    const topic = app.ctx.theone.bubbleView(app.gateway.id).topics.find(topic => topic.id === 'ctx_thesis')
    assert.ok(topic); assert.equal(topic.capabilities.declareDone.allowed, false)
    store.interruptTopicRuns()
    assert.equal((await done()).status, 409)
    assert.equal(app.model.requests.length, before)
    assert.equal(store.declaredTopics().has('ctx_thesis'), false)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
