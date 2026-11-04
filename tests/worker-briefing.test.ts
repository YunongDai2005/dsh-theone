import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompactionId } from '@deepseek-ai/dsh-compaction/types'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ask, harness, FixtureModel, textResponse } from './harness.ts'

const QWEN = 'ctx_qwen_9070xt', THESIS = 'ctx_thesis'
const textOf = (message: UserMessage) => message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
const recalls = (events: readonly SessionEvent[]) => events.flatMap(event =>
  event.type === 'user/message' && event.data.source.kind === 'theone-context' ? [event.data] : [])
const full = (events: readonly SessionEvent[]) => recalls(events).filter(message => textOf(message).includes('"title":'))

async function setup(t: TestContext, factLinks = false) {
  const root = await mkdtemp(join(tmpdir(), 'theone-worker-briefing-'))
  const model = new FixtureModel()
  model.behavior = async function* () { yield* textResponse('好的') }
  const app = await harness(root, model, { theoneConfig: { factLinks, linkScope: 'off' } })
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }) })
  const worker = (id = QWEN) => app.ctx.agents.get(SessionId(app.ctx.theone.store.contexts().find(topic => topic.id === id)!.workingSessionId))!
  return { app, worker }
}

// The real DSH durable protocol: a log-only summary, a surface replacement, then end.
// Keeping the descriptor summary identical makes the test independent of hash changes.
function compact(worker: Agent, summary: string, fromSeq = 0) {
  const compactionId = randomUUID() as CompactionId
  const seqs = worker.session.surface.nodes.filter(seq => {
    const event = worker.session.snapshotEvents().find(event => event.seq === seq)!
    return seq >= fromSeq && event.type !== 'system/message' && event.type !== 'developer/message'
  })
  const range = { start: seqs[0], end: seqs.at(-1)! }
  worker.session.append('compaction/start', { compactionId, turn: null })
  worker.session.append('compaction/summary', { compactionId, summary: [{ type: 'text', text: summary }],
    shadowedRange: range, shadowedSeqs: seqs, shadowedTokenCount: 1000, provider: 'fixture', model: 'fixture' })
  worker.session.append('user/message', createUserMessage({ source: compactCheckpointSource(compactionId),
    content: [{ type: 'text', text: summary }] }),
  { surfaceOp: { op: 'replace', startSeq: range.start, endSeq: range.end }, sourceEventSeqs: seqs })
  worker.session.append('compaction/end', { compactionId, turn: null })
}

test('each worker gets its first briefing once; unchanged turns and topic switches reuse it', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  const first = await ask(app.gateway, 'Qwen 那个')
  assert.equal(first.end?.data.reason.kind, 'completed')
  assert.equal(full(worker().session.snapshotEvents()).length, 1)
  assert.match(textOf(full(worker().session.snapshotEvents())[0]), /RX 9070 XT/)
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(recalls(worker().session.snapshotEvents()).length, 1, 'unchanged input adds no recall')
  await ask(app.gateway, '论文那个')
  assert.equal(full(worker(THESIS).session.snapshotEvents()).length, 1)
  await ask(app.gateway, '回到 Qwen 那个')
  assert.equal(full(worker().session.snapshotEvents()).length, 1, 'other workers cannot invalidate this worker')
})

test('descriptor changes are injected once and identical updates do not add another briefing', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  await ask(app.gateway, 'Qwen 那个')
  const store = app.ctx.theone.store
  store.updateState(QWEN, '驱动已安装，接着验证推理', worker().id, worker().session.snapshotEvents().at(-1)!.seq)
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(full(worker().session.snapshotEvents()).length, 2)
  assert.match(textOf(full(worker().session.snapshotEvents()).at(-1)!), /驱动已安装，接着验证推理/)
  store.updateState(QWEN, '驱动已安装，接着验证推理', worker().id, worker().session.snapshotEvents().at(-1)!.seq)
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(full(worker().session.snapshotEvents()).length, 2)
})

test('own facts participate in the briefing fingerprint', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t, true)
  await ask(app.gateway, 'Qwen 显存 16 GB')
  const evidence = worker().session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!
  app.ctx.theone.store.recordFact(QWEN, { label: '显存', kind: 'fact', value: '16 GB', status: 'confirmed', origin: 'worker',
    evidence: { sessionId: worker().id, seq: evidence.seq, speaker: 'user', quote: '显存 16 GB' } })
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(full(worker().session.snapshotEvents()).length, 2)
  assert.match(textOf(full(worker().session.snapshotEvents()).at(-1)!), /16 GB/)
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(full(worker().session.snapshotEvents()).length, 2)
})

test('successful compaction restores identical briefing text once, even after repeated compaction', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  await ask(app.gateway, 'Qwen 那个')
  const original = textOf(full(worker().session.snapshotEvents())[0])
  for (let count = 2; count <= 3; count++) {
    // First compact only the conversation after the briefing: a successful end itself invalidates it.
    const from = count === 2 ? worker().session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!.seq : 0
    compact(worker(), app.ctx.theone.store.contexts().find(topic => topic.id === QWEN)!.summary, from)
    await ask(app.gateway, 'Qwen 继续')
    assert.equal(full(worker().session.snapshotEvents()).length, count)
    assert.equal(textOf(full(worker().session.snapshotEvents()).at(-1)!), original)
    await ask(app.gateway, 'Qwen 继续')
    assert.equal(full(worker().session.snapshotEvents()).length, count, 'a completed compaction is consumed only once')
  }
})

test('failed compaction and compaction in another session do not refresh a worker briefing', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  await ask(app.gateway, 'Qwen 那个')
  const compactionId = randomUUID() as CompactionId
  worker().session.append('compaction/start', { compactionId, turn: null })
  worker().session.append('compaction/end', { compactionId, turn: null, error: 'fixture summary failed' })
  compact(app.gateway, '主聊天摘要')
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(full(worker().session.snapshotEvents()).length, 1)
})

test('restart injects the briefing again into the same persisted worker session', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-briefing-restart-'))
  const model = new FixtureModel()
  model.behavior = async function* () { yield* textResponse('好的') }
  let app = await harness(root, model, { theoneConfig: { linkScope: 'off' } })
  try {
    await ask(app.gateway, 'Qwen 那个')
    const sessionId = SessionId(app.ctx.theone.store.contexts().find(topic => topic.id === QWEN)!.workingSessionId)
    await app.close()
    app = await harness(root, model, { theoneConfig: { linkScope: 'off' } })
    await ask(app.gateway, 'Qwen 继续')
    const worker = app.ctx.agents.get(sessionId)!
    assert.equal(full(worker.session.snapshotEvents()).length, 2)
    await ask(app.gateway, 'Qwen 继续')
    assert.equal(full(worker.session.snapshotEvents()).length, 2)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('resume hints are separate from unchanged briefing text and are injected only once', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  const first = await ask(app.gateway, 'Qwen 那个')
  const store = app.ctx.theone.store
  store.startTopicRun(first.input.id, QWEN, worker().id)
  store.interruptTopicRuns()
  const offset = worker().session.snapshotEvents().length
  await ask(app.gateway, 'Qwen 继续')
  const added = worker().session.snapshotEvents().slice(offset)
  assert.equal(full(added).length, 0)
  assert.equal(recalls(added).length, 1)
  assert.match(textOf(recalls(added)[0]), /DSH 重启打断了你/)
  const next = worker().session.snapshotEvents().length
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(recalls(worker().session.snapshotEvents().slice(next)).length, 0)
})

test('misroute hints remain separate when the unchanged briefing survives exclusion', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  await ask(app.gateway, 'Qwen 那个')
  const second = await ask(app.gateway, 'Qwen 继续')
  const store = app.ctx.theone.store
  const binding = store.learningJournal.turns(worker().id).find(turn => turn.source.messageId === second.input.id)!
  store.recordMisroute({ messageId: second.input.id, contextId: QWEN, sessionId: worker().id,
    startSeq: binding.startSeq, endSeq: binding.endSeq, movedTo: '论文', request: 'Qwen 继续' })
  const offset = worker().session.snapshotEvents().length
  await ask(app.gateway, 'Qwen 那个')
  const added = worker().session.snapshotEvents().slice(offset)
  assert.equal(full(added).length, 0)
  assert.equal(recalls(added).length, 1)
  assert.match(textOf(recalls(added)[0]), /已经转给「论文」处理/)
  assert.doesNotMatch(textOf(recalls(added)[0]), /Qwen 继续/)
  const next = worker().session.snapshotEvents().length
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(recalls(worker().session.snapshotEvents().slice(next)).length, 0)
})

test('excluding a turn that carried the full briefing restores it even when the text is unchanged', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  const first = await ask(app.gateway, 'Qwen 那个')
  const store = app.ctx.theone.store
  const original = textOf(full(worker().session.snapshotEvents())[0])
  const binding = store.learningJournal.turns(worker().id).find(turn => turn.source.messageId === first.input.id)!
  store.recordMisroute({ messageId: first.input.id, contextId: QWEN, sessionId: worker().id,
    startSeq: binding.startSeq, endSeq: binding.endSeq, movedTo: '论文', request: 'Qwen 那个' })
  const offset = worker().session.snapshotEvents().length
  await ask(app.gateway, 'Qwen 那个')
  assert.equal(full(worker().session.snapshotEvents().slice(offset)).length, 1)
  assert.equal(textOf(full(worker().session.snapshotEvents()).at(-1)!), original)
})

test('return-after-a-break hints do not invalidate the full briefing', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  await ask(app.gateway, 'Qwen 那个')
  const offset = worker().session.snapshotEvents().length
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 30 * 86400000 })
  await ask(app.gateway, 'Qwen 继续')
  const added = worker().session.snapshotEvents().slice(offset)
  assert.equal(full(added).length, 0)
  assert.match(textOf(recalls(added)[0]), /这个话题上次活动是/)
  const next = worker().session.snapshotEvents().length
  await ask(app.gateway, 'Qwen 继续')
  assert.equal(recalls(worker().session.snapshotEvents().slice(next)).length, 0)
})

test('turns without a briefing retain handback rules and independent learning provenance', { timeout: 30000 }, async t => {
  const { app, worker } = await setup(t)
  const first = await ask(app.gateway, 'Qwen 那个')
  const offset = worker().session.snapshotEvents().length
  const second = await ask(app.gateway, 'Qwen 继续')
  assert.equal(recalls(worker().session.snapshotEvents().slice(offset)).length, 0)
  const rule = app.model.requests.at(-1)!.tools?.find(tool => tool.name === 'theone_handback')?.description
  assert.ok(rule, 'handback must remain available in the actual request')
  assert.match(rule, /clearly belongs to another matter/)
  assert.match(rule, /Call it first/)
  assert.match(rule, /When unsure.*answer as usual/)
  const journal = app.ctx.theone.store.learningJournal
  const bound = journal.turns(worker().id).find(turn => turn.source.messageId === second.input.id)!
  assert.ok(bound, 'the user turn is bound without a recall')
  assert.ok(bound.sources.some(source => source.messageId === first.input.id), 'prior reference dependencies are retained')
  assert.ok(bound.sources.some(source => source.messageId === second.input.id), 'the current source is retained')
  assert.ok(bound.endSeq >= bound.startSeq)
})
