import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { harness, FixtureModel, textResponse } from './harness.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import type { BubbleView } from '../src/bubble-types.ts'

const say = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const words = (options: { messages: readonly { role: string; content: unknown }[] }) => options.messages.filter(m => m.role === 'user').map(m => JSON.stringify(m.content)).join(' ')
export function observed(app: Awaited<ReturnType<typeof harness>>, predicate: (view: BubbleView) => boolean): Promise<BubbleView> {
  const ready = Promise.withResolvers<BubbleView>()
  const check = () => { const view = app.ctx.theone.bubbleView(app.gateway.id); if (predicate(view)) { off(); ready.resolve(view) } }
  const off = app.ctx.theone.bubbleActivity.subscribe(check)
  check()
  return ready.promise
}

for (const completedEarly of [true, false]) test('background execution is observed independently of delivery: early=' + completedEarly, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubbles-'))
  const a = Promise.withResolvers<void>(), b = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  const model = new FixtureModel(), calls: string[] = []
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text) as { text: string }
      const contextId = payload.text.includes('thesis') ? 'ctx_thesis' : 'ctx_qwen_9070xt'
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId, reason: 'fixture' })); return
    }
    const context = options.messages.find(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context')
    const contextId = context && 'source' in context && context.source?.kind === 'theone-context' ? context.source.contextId : 'unknown'
    calls.push(contextId)
    if (contextId === 'ctx_qwen_9070xt') { entered.resolve(); await a.promise } else await b.promise
    yield* textResponse(contextId + ' answer')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    app.gateway.followup(say('Qwen hardware')); await entered.promise
    const input = say('thesis experiment')
    app.gateway.steer(input)
    await observed(app, v => v.workItems.some(w => w.primaryMessageId === input.id && w.phase === 'running'))
    if (completedEarly) b.resolve()
    const before = await observed(app, v => v.workItems.some(w => w.primaryMessageId === input.id && w.phase === (completedEarly ? 'succeeded' : 'running')))
    const work = before.workItems.find(w => w.primaryMessageId === input.id)!
    assert.equal(work.delivery.phase, 'waiting')
    assert.ok(work.executionId)
    assert.ok(work.batchId)
    assert.equal(before.topics.find(t => t.current)?.id, 'ctx_qwen_9070xt')
    assert.equal(app.ctx.theone.store.topicRun(input.id)?.outcome, 'running')
    assert.equal(before.gateway!.nextTurn[0].messageId, input.id)
    const selected = observed(app, v => v.workItems.some(w => w.id === work.id && w.delivery.phase === 'showing'))
    a.resolve(); await selected; b.resolve()
    await observed(app, v => v.workItems.some(w => w.id === work.id && w.delivery.phase === 'shown'))
    await app.gateway.whenIdle()
    const after = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === work.id)!
    assert.equal(after.executionId, work.executionId)
    assert.equal(after.delivery.committedSteps, 1)
    assert.ok(after.delivery.commit)
    assert.deepEqual(calls, ['ctx_qwen_9070xt', 'ctx_thesis'])
    const replies = app.gateway.session.snapshotEvents().flatMap(e => e.type === 'assistant/message' ? e.data.message.content.flatMap(b => b.type === 'text' ? b.text : []) : [])
    assert.deepEqual(replies, ['ctx_qwen_9070xt answer', 'ctx_thesis answer'])
  } finally { a.resolve(); b.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('claimed inputs remain observable during classification and GET-style projection never calls a model', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-claim-'))
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) { entered.resolve(); await gate.promise; yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: 'ctx_thesis', reason: 'fixture' })); return }
    yield* textResponse('answer')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const input = say('thesis experiment'); app.gateway.followup(input); await entered.promise
    const calls = model.requests.length
    const view = app.ctx.theone.bubbleView(app.gateway.id)
    assert.deepEqual(view.gateway!.claimed[0].messageIds, [input.id])
    assert.equal(view.workItems.find(w => w.primaryMessageId === input.id)!.phase, 'routing')
    assert.equal(view.workItems.find(w => w.primaryMessageId === input.id)!.contextId, null)
    assert.equal(model.requests.length, calls)
    gate.resolve(); await app.gateway.whenIdle()
    assert.deepEqual(app.ctx.theone.bubbleView(app.gateway.id).gateway!.claimed, [])
  } finally { gate.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('capacity, busy targets and unknown creates stay queued; requeue is not cancellation', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-queue-'))
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text) as { text: string }
      yield* textResponse(JSON.stringify(payload.text.includes('new-task') ? { action: 'CREATE', title: 'Brand new separate project', reason: 'independent', historyIndependent: true }
        : { action: 'EXISTING', contextId: payload.text.includes('second') ? 'second' : payload.text.includes('third') ? 'third' : 'ctx_qwen_9070xt', reason: 'fixture' })); return
    }
    entered.resolve(); await gate.promise; yield* textResponse('answer')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    app.ctx.theone.store.seed(['second', 'third'].map(id => ({ id, title: id, summary: id, entities: [], keywords: [], lastState: '' })))
    app.gateway.followup(say('Qwen hardware')); await entered.promise
    const busy = say('Qwen hardware again'); app.gateway.followup(busy)
    await observed(app, v => v.workItems.some(w => w.primaryMessageId === busy.id && w.queueReason === 'topic_busy'))
    const second = say('second topic'), third = say('third topic')
    const events: string[] = []
    const off = app.ctx.theone.bubbleActivity.subscribe(es => { for (const e of es) if (e.type === 'delivery.changed') events.push(e.phase) })
    app.gateway.steer(second)
    await observed(app, v => v.workItems.some(w => w.primaryMessageId === second.id && w.phase === 'running'))
    app.gateway.followup(third)
    await observed(app, v => v.workItems.some(w => w.primaryMessageId === third.id && w.phase === 'running'))
    const fresh = say('new-task needs its own plan'); app.gateway.followup(fresh)
    const view = await observed(app, v => v.workItems.some(w => w.primaryMessageId === fresh.id && w.queueReason === 'capacity'))
    assert.equal(view.workItems.find(w => w.primaryMessageId === fresh.id)!.contextId, null)
    assert.equal(view.topics.some(t => t.title === 'Brand new separate project'), false)
    assert.equal(events.includes('discarded'), false)
    app.gateway.inbox.remove(second.id)
    const discarded = await observed(app, v => v.workItems.some(w => w.primaryMessageId === second.id && w.delivery.phase === 'discarded'))
    assert.ok(discarded.workItems.find(w => w.primaryMessageId === second.id)!.executionId)
    for (const input of [busy, third, fresh]) app.gateway.inbox.remove(input.id)
    gate.resolve(); await app.gateway.whenIdle(); off()
  } finally { gate.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('same-project work reports waiting before the Worker actually starts', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-project-'))
  let firstId = '', secondId = ''
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text) as { text: string }
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: payload.text.includes('thesis') ? secondId : firstId, reason: 'fixture' })); return
    }
    entered.resolve(); await gate.promise; yield* textResponse('answer')
  }
  const app = await harness(root, model, { routerMode: 'llm', cwd: root })
  try {
    firstId = app.ctx.theone.store.plan('seed-a', app.gateway.id, 'test-gateway', { action: 'CREATE', title: 'Project A', folder: root, reason: 'fixture' }, false).decision.contextId!
    secondId = app.ctx.theone.store.plan('seed-b', app.gateway.id, 'test-gateway', { action: 'CREATE', title: 'Project B', folder: root, reason: 'fixture' }, false).decision.contextId!
    app.gateway.followup(say('Qwen hardware')); await entered.promise
    const input = say('thesis experiment'); app.gateway.followup(input)
    const view = await observed(app, v => v.workItems.some(w => w.primaryMessageId === input.id && w.queueReason === 'project_busy'))
    assert.equal(view.workItems.find(w => w.primaryMessageId === input.id)!.executionId, null)
    gate.resolve(); await app.gateway.whenIdle()
    await observed(app, v => v.workItems.some(w => w.primaryMessageId === input.id && w.delivery.phase === 'shown'))
  } finally { gate.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})
