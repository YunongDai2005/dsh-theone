import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { harness, ask, peered, FixtureModel, textResponse } from './harness.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'

const say = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
async function api(app: Awaited<ReturnType<typeof harness>>) {
  const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
  await new Promise<void>(resolve => setImmediate(resolve))
  return async (workItemId: string) => {
    const res = await handler.fetch(new Request('http://dsh.internal/api/theone/topics', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop', workItemId }) }))
    return { status: res.status, body: await res.json() as Record<string, any> }
  }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('work did not reach the expected state')
}
function waitForAbort(signal?: AbortSignal) {
  assert.ok(signal)
  return new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) })
}
const texts = (events: readonly any[]) => events.flatMap(e => e.type === 'assistant/message' ? e.data.message.content.flatMap((b: any) => b.type === 'text' ? [b.text] : []) : [])

test('stop cancels one foreground execution and preserves committed results and delivery evidence', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-')), app = await harness(root)
  const entered = Promise.withResolvers<void>()
  try {
    let step = 0
    app.model.behavior = async function* (options) {
      if (step++ === 0) {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'saved result' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'saved result' } }
        yield { type: 'block-start', index: 1, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 1, id: 'save' as never, name: 'theone_update_state', argumentsDelta: '{"state":"saved progress"}' }
        yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'save' as never, name: 'theone_update_state', arguments: '{"state":"saved progress"}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
      }
      entered.resolve(); await waitForAbort(options.signal); options.signal!.throwIfAborted()
    }
    const stop = await api(app), reply = ask(app.gateway, 'Qwen hardware'); await entered.promise
    const work = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.executionId)!
    assert.equal(work.stop.allowed, true)
    const events: string[] = []
    const off = app.ctx.theone.bubbleActivity.subscribe(batch => events.push(...batch.map(e => e.type)))
    const result = await stop(work.id)
    assert.equal(result.status, 200); assert.equal(result.body.effect, 'stopped')
    assert.equal(result.body.executionId, work.executionId)
    await reply
    const after = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === work.id)!
    assert.equal(after.phase, 'stopped'); assert.equal(after.stop.allowed, false)
    assert.ok(after.delivery.committedSteps >= 1)
    assert.ok(texts(app.gateway.session.snapshotEvents()).includes('saved result'))
    const context = app.ctx.theone.store.contexts().find(c => c.id === work.contextId)!
    assert.equal(context.lastState, 'saved progress')
    assert.ok(texts(app.ctx.agents.get(SessionId(context.workingSessionId))!.session.snapshotEvents()).includes('saved result'))
    assert.ok(events.includes('work.changed')); assert.ok(events.includes('delivery.changed')); off()
    assert.equal((await stop(work.id)).status, 409)
  } finally { app.gateway.cancel({ kind: 'parent' }); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('withdrawing a queued input cannot cancel the current reply or allow the input to execute later', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-withdraw-')), app = await harness(root)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* () { entered.resolve(); await release.promise; yield* textResponse('first answer') }
    const stop = await api(app), reply = ask(app.gateway, 'Qwen hardware'); await entered.promise
    const input = say('Qwen additional input'); app.gateway.followup(input)
    const work = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.primaryMessageId === input.id)!
    assert.equal(work.stop.allowed, true)
    const events: string[] = []
    const off = app.ctx.theone.bubbleActivity.subscribe(batch => events.push(...batch.map(e => e.type)))
    const result = await stop(work.id)
    assert.equal(result.status, 200); assert.equal(result.body.effect, 'withdrawn')
    assert.equal(result.body.executionId, null)
    assert.equal(app.gateway.inbox.nextTurn.some(m => m.id === input.id), false)
    const after = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === work.id)!
    assert.equal(after.phase, 'stopped'); assert.equal(after.delivery.phase, 'discarded')
    assert.ok(events.includes('work.changed')); assert.ok(events.includes('delivery.changed')); off()
    release.resolve(); assert.equal((await reply).output, 'first answer'); await app.gateway.whenIdle()
    assert.equal(app.model.requests.length, 1)
    assert.equal((await stop(work.id)).body.error, 'WORK_ALREADY_STOPPED')
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('stopping a background execution leaves the foreground reply and the stopped run record intact', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-background-')), gate = Promise.withResolvers<void>()
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text)
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: payload.text.includes('thesis') ? 'ctx_thesis' : 'ctx_qwen_9070xt', reason: 'fixture' })); return
    }
    const descriptor = options.messages.find(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context') as any
    if (descriptor.source.contextId === 'ctx_qwen_9070xt') { await gate.promise; yield* textResponse('foreground answer') }
    else { await waitForAbort(options.signal); options.signal!.throwIfAborted() }
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const stop = await api(app), reply = ask(app.gateway, 'Qwen hardware')
    await until(() => app.ctx.theone.bubbleView(app.gateway.id).workItems.some(w => w.phase === 'running'))
    const input = say('thesis experiment'); app.gateway.followup(input)
    await until(() => app.ctx.theone.bubbleView(app.gateway.id).workItems.some(w => w.primaryMessageId === input.id && w.phase === 'running'))
    const work = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.primaryMessageId === input.id)!
    assert.equal(work.stop.allowed, true)
    const result = await stop(work.id)
    assert.equal(result.status, 200); assert.equal(result.body.effect, 'stopped')
    assert.equal(app.ctx.theone.store.topicRun(input.id)?.outcome, 'stopped')
    assert.ok(app.ctx.theone.store.route(input.id))
    assert.equal(app.gateway.inbox.nextTurn.some(m => m.id === input.id), false)
    assert.ok(app.ctx.theone.bubbleView(app.gateway.id).workItems.some(w => w.contextId === 'ctx_qwen_9070xt' && w.phase === 'running'))
    gate.resolve(); assert.equal((await reply).output, 'foreground answer'); await app.gateway.whenIdle()
    assert.equal(app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === work.id)!.phase, 'stopped')
  } finally { gate.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('already delivered, missing and recovered work expose matching stop errors and capabilities', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-errors-')), app = await harness(root)
  try {
    const stop = await api(app)
    const missing = await stop('missing'); assert.equal(missing.status, 404); assert.equal(missing.body.error, 'UNKNOWN_WORK_ITEM')
    await ask(app.gateway, 'Qwen hardware')
    const work = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.executionId)!
    assert.equal(work.stop.allowed, false)
    const result = await stop(work.id)
    assert.equal(result.status, 409); assert.equal(result.body.error, 'WORK_ALREADY_DELIVERED')
    app.ctx.theone.store.plan('recovery', app.gateway.id, 'test-gateway', { action: 'KEEP', contextId: 'ctx_thesis', reason: 'fixture' })
    app.ctx.theone.store.startTopicRun('recovery', 'ctx_thesis', 'worker')
    const recovered = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === 'record:recovery')!
    assert.equal(recovered.stop.allowed, false)
    assert.equal((await stop(recovered.id)).body.error, 'WORK_NOT_STOPPABLE')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('stopping during classification cancels only the claimed input before any Worker starts', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-routing-')), model = new FixtureModel()
  const entered = Promise.withResolvers<void>()
  model.behavior = async function* (options) { entered.resolve(); await waitForAbort(options.signal); options.signal!.throwIfAborted() }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const stop = await api(app), reply = ask(app.gateway, 'Qwen hardware'); await entered.promise
    const work = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.phase === 'routing')!
    assert.equal(work.stop.allowed, true)
    const result = await stop(work.id)
    assert.equal(result.status, 200); assert.equal(result.body.effect, 'stopped'); assert.equal(result.body.executionId, null)
    await reply
    assert.equal(app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === work.id)!.phase, 'stopped')
    assert.equal(model.requests.length, 1)
  } finally { app.gateway.cancel({ kind: 'parent' }); await app.close(); await rm(root, { recursive: true, force: true }) }
})

for (const preparing of [false, true]) test('withdraw or stop background preparation cannot start it later: preparing=' + preparing, { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-preparation-')), model = new FixtureModel()
  const foreground = Promise.withResolvers<void>(), preparation = Promise.withResolvers<void>(), calls: string[] = []
  let firstId = '', secondId = ''
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text)
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: payload.text.includes('second') ? secondId : firstId, reason: 'fixture' })); return
    }
    const descriptor = options.messages.find(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context') as any
    calls.push(descriptor.source.contextId)
    await foreground.promise; yield* textResponse('answer')
  }
  const app = await harness(root, model, { routerMode: 'llm', cwd: root })
  try {
    firstId = app.ctx.theone.store.plan('seed-a', app.gateway.id, 'test-gateway', { action: 'CREATE', title: 'First project', folder: root, reason: 'fixture' }, false).decision.contextId!
    secondId = preparing ? 'ctx_thesis' : app.ctx.theone.store.plan('seed-b', app.gateway.id, 'test-gateway', { action: 'CREATE', title: 'Second project', folder: root, reason: 'fixture' }, false).decision.contextId!
    if (preparing) {
      const service = app.ctx.theone as any, original = service.briefingFor.bind(service)
      t.mock.method(service, 'briefingFor', async (...args: any[]) => {
        if (args[0].id === secondId) await preparation.promise
        return original(...args)
      })
    }
    const stop = await api(app), reply = ask(app.gateway, 'first project')
    await until(() => calls.includes(firstId))
    const input = say('second project'); app.gateway.followup(input)
    await until(() => app.ctx.theone.bubbleView(app.gateway.id).workItems.some(w => w.primaryMessageId === input.id &&
      (preparing ? w.phase === 'starting' && !!w.executionId : w.queueReason === 'project_busy')))
    const work = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.primaryMessageId === input.id)!
    assert.equal(work.stop.allowed, true)
    assert.equal((await stop(work.id)).body.effect, preparing ? 'stopped' : 'withdrawn')
    preparation.resolve(); foreground.resolve(); await reply; await app.gateway.whenIdle()
    await until(() => (app.ctx.theone as any).sorting.size === 0)
    assert.deepEqual(calls, [firstId])
    const after = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === work.id)!
    assert.equal(after.phase, 'stopped'); assert.equal(after.delivery.phase, 'discarded')
  } finally { preparation.resolve(); foreground.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

for (const mode of ['rules', 'llm', 'routing'] as const) test('stopping one foreground input routes and executes the remaining queue in order: ' + mode, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-keep-queue-')), model = new FixtureModel()
  const firstEntered = Promise.withResolvers<void>(), secondEntered = Promise.withResolvers<void>(), releaseSecond = Promise.withResolvers<void>()
  const routed: string[] = []
  let workerCalls = 0
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text)
      routed.push(payload.text)
      if (mode === 'routing' && payload.text === 'Qwen first') {
        firstEntered.resolve(); await waitForAbort(options.signal); options.signal!.throwIfAborted()
      }
      // While A replies, an undecided mid-reply classification leaves B in the host queue.
      const contextId = payload.running?.topicId ?? (payload.text.includes('thesis') ? 'ctx_thesis' : 'ctx_qwen_9070xt')
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId, reason: 'fixture' })); return
    }
    const message = options.messages.findLast(m => m.role === 'user' && 'source' in m && m.source?.kind === 'user')!
    const request = message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('')
    workerCalls++
    if (request === 'Qwen first') {
      firstEntered.resolve(); await waitForAbort(options.signal); options.signal!.throwIfAborted()
    }
    if (request.endsWith('thesis second')) { secondEntered.resolve(); await releaseSecond.promise }
    yield* textResponse('answer: ' + request)
  }
  const app = await harness(root, model, { routerMode: mode === 'rules' ? 'rules' : 'llm' })
  try {
    const stop = await api(app), first = say('Qwen first'), second = say('thesis second'), third = say('Qwen third')
    app.gateway.followup(first); await firstEntered.promise
    const work = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.primaryMessageId === first.id)!
    app.gateway.followup(second); app.gateway.followup(third)
    await until(() => app.ctx.theone.bubbleView(app.gateway.id).workItems.filter(w => (w.primaryMessageId === second.id || w.primaryMessageId === third.id)).every(w => w.phase === 'queued'))
    const before = app.ctx.theone.bubbleView(app.gateway.id)
    const queued = before.workItems.find(w => w.primaryMessageId === second.id)!
    assert.equal(queued.phase, 'queued'); assert.equal(queued.executionId, null)
    if (mode !== 'llm') assert.equal(queued.contextId, null)
    assert.deepEqual(before.gateway!.nextTurn.map(m => m.messageId), [second.id, third.id])
    let stoppedResult: Awaited<ReturnType<typeof stop>> | undefined
    const stopping = stop(work.id).then(result => { stoppedResult = result })
    await until(() => !!stoppedResult)
    await stopping
    const result = stoppedResult!
    assert.equal(result.status, 200); assert.equal(result.body.effect, 'stopped')
    const after = app.ctx.theone.bubbleView(app.gateway.id)
    assert.equal(after.workItems.find(w => w.id === work.id)!.phase, 'stopped')
    assert.notEqual(after.workItems.find(w => w.id === queued.id)!.phase, 'stopped', 'stopping A must not withdraw queued B')
    // The stop response must not wait for B's answer to finish.
    await secondEntered.promise
    releaseSecond.resolve(); await app.gateway.whenIdle()
    const final = app.ctx.theone.bubbleView(app.gateway.id)
    assert.equal(final.workItems.find(w => w.id === queued.id)!.phase, 'succeeded')
    assert.equal(final.workItems.find(w => w.id === queued.id)!.delivery.phase, 'shown')
    assert.equal(app.ctx.theone.store.route(second.id)?.decision.contextId, 'ctx_thesis')
    assert.equal(app.ctx.theone.store.route(second.id)?.status, 'completed')
    assert.equal(app.ctx.theone.store.topicRun(second.id)?.outcome, 'completed')
    assert.equal(app.ctx.theone.store.route(third.id)?.status, 'completed')
    assert.deepEqual(texts(app.gateway.session.snapshotEvents()), ['answer: thesis second', 'answer: Qwen third'])
    const userIds = app.gateway.session.snapshotEvents().flatMap(e => e.type === 'user/message' && e.data.source.kind === 'user' ? [e.data.id] : [])
    assert.deepEqual(userIds.filter(id => id === second.id || id === third.id), [second.id, third.id])
    assert.equal(workerCalls, mode === 'routing' ? 2 : 3)
    if (mode !== 'rules') assert.ok(routed.includes('thesis second'))
  } finally { releaseSecond.resolve(); app.gateway.cancel({ kind: 'parent' }); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('foreground stop preserves a background answer still queued for delivery', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-queued-delivery-')), model = new FixtureModel()
  const entered = Promise.withResolvers<void>()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text)
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: payload.text.includes('thesis') ? 'ctx_thesis' : 'ctx_qwen_9070xt', reason: 'fixture' })); return
    }
    const descriptor = options.messages.find(m => m.role === 'user' && 'source' in m && m.source?.kind === 'theone-context') as any
    if (descriptor.source.contextId === 'ctx_qwen_9070xt') { entered.resolve(); await waitForAbort(options.signal); options.signal!.throwIfAborted() }
    yield* textResponse('queued background answer')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const stop = await api(app), first = say('Qwen first'), second = say('thesis second')
    app.gateway.followup(first); await entered.promise
    app.gateway.followup(second)
    await until(() => app.ctx.theone.bubbleView(app.gateway.id).workItems.some(w => w.primaryMessageId === second.id && w.phase === 'succeeded'))
    const before = app.ctx.theone.bubbleView(app.gateway.id)
    const firstWork = before.workItems.find(w => w.primaryMessageId === first.id)!, secondWork = before.workItems.find(w => w.primaryMessageId === second.id)!
    assert.equal(secondWork.delivery.phase, 'waiting')
    assert.equal((await stop(firstWork.id)).status, 200)
    await app.gateway.whenIdle()
    const after = app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === secondWork.id)!
    assert.equal(after.delivery.phase, 'shown')
    assert.equal(after.executionId, secondWork.executionId)
    assert.equal(app.ctx.theone.store.route(second.id)?.status, 'completed')
    assert.deepEqual(texts(app.gateway.session.snapshotEvents()), ['queued background answer'])
  } finally { app.gateway.cancel({ kind: 'parent' }); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('queue changes during foreground stop respect explicit withdrawal and newly submitted input', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-queue-race-')), app = await harness(root)
  const entered = Promise.withResolvers<void>(), aborting = Promise.withResolvers<void>(), drain = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* (options) {
      const message = options.messages.findLast(m => m.role === 'user' && 'source' in m && m.source?.kind === 'user')!
      const request = message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('')
      if (request === 'Qwen first') {
        entered.resolve(); await waitForAbort(options.signal); aborting.resolve(); await drain.promise; options.signal!.throwIfAborted()
      }
      yield* textResponse('answer: ' + request)
    }
    const stop = await api(app), first = say('Qwen first'), withdrawn = say('thesis withdrawn'), kept = say('thesis kept'), arrived = say('Qwen arrived')
    app.gateway.followup(first); await entered.promise
    app.gateway.followup(withdrawn); app.gateway.followup(kept)
    const before = app.ctx.theone.bubbleView(app.gateway.id)
    const firstWork = before.workItems.find(w => w.primaryMessageId === first.id)!, withdrawnWork = before.workItems.find(w => w.primaryMessageId === withdrawn.id)!
    const stopping = stop(firstWork.id); await aborting.promise
    const withdrawal = await stop(withdrawnWork.id)
    assert.equal(withdrawal.status, 200); assert.equal(withdrawal.body.effect, 'withdrawn')
    app.gateway.followup(arrived)
    drain.resolve(); assert.equal((await stopping).status, 200); await app.gateway.whenIdle()
    assert.equal(app.ctx.theone.store.route(withdrawn.id), undefined)
    assert.equal(app.ctx.theone.store.route(kept.id)?.status, 'completed')
    assert.equal(app.ctx.theone.store.route(arrived.id)?.status, 'completed')
    assert.deepEqual(texts(app.gateway.session.snapshotEvents()), ['answer: thesis kept', 'answer: Qwen arrived'])
    assert.equal(app.ctx.theone.bubbleView(app.gateway.id).workItems.find(w => w.id === firstWork.id)!.phase, 'stopped')
  } finally { drain.resolve(); app.gateway.cancel({ kind: 'parent' }); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('stopping routing resumes the pending steering batch without splitting or duplicating it', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stop-next-step-')), model = new FixtureModel()
  const entered = Promise.withResolvers<void>()
  let workerCalls = 0
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0].content as readonly { text: string }[])[0].text)
      if (payload.text === 'Qwen first') { entered.resolve(); await waitForAbort(options.signal); options.signal!.throwIfAborted() }
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: 'ctx_thesis', reason: 'fixture' })); return
    }
    workerCalls++
    const input = options.messages.findLast(m => m.role === 'user' && 'source' in m && m.source?.kind === 'user')!
    yield* textResponse(input.content.flatMap(b => b.type === 'text' ? [b.text] : []).join(''))
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const stop = await api(app), first = say('Qwen first'), second = say('thesis second'), supplement = say('thesis supplement')
    app.gateway.followup(first); await entered.promise
    app.gateway.steer(second); app.gateway.steer(supplement)
    const before = app.ctx.theone.bubbleView(app.gateway.id)
    assert.deepEqual(before.gateway!.nextStep.map(m => m.messageId), [second.id, supplement.id])
    const work = before.workItems.find(w => w.primaryMessageId === first.id)!
    assert.equal((await stop(work.id)).status, 200); await app.gateway.whenIdle()
    assert.deepEqual(texts(app.gateway.session.snapshotEvents()), ['thesis second\n\nthesis supplement'])
    assert.equal(workerCalls, 1)
    const after = app.ctx.theone.bubbleView(app.gateway.id)
    const batch = after.workItems.find(w => w.primaryMessageId === supplement.id)!
    assert.deepEqual(batch.messageIds, [supplement.id, second.id])
    assert.equal(batch.phase, 'succeeded'); assert.equal(batch.delivery.phase, 'shown')
    assert.equal(after.workItems.find(w => w.id === work.id)!.phase, 'stopped')
  } finally { app.gateway.cancel({ kind: 'parent' }); await app.close(); await rm(root, { recursive: true, force: true }) }
})
