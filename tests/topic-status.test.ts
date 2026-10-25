import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextStore, RUNS_KEPT } from '../src/store.ts'
import { topicStatus } from '../src/topic-memory.ts'

const topic = (id: string) => ({ id, title: id, summary: id, entities: [], keywords: [], lastState: '进行中' })

test('a topic keeps its latest runs, apart from its status; a restart marks unfinished work interrupted', () => {
  const root = mkdtempSync(join(tmpdir(), 'theone-runs-'))
  const path = join(root, 'store.db')
  try {
    const store = new ContextStore(path)
    store.seed([topic('trip'), topic('paper')])
    for (let i = 0; i < RUNS_KEPT + 5; i++) { store.startTopicRun(`m${i}`, 'trip', 's-trip', 1000 + i); store.endTopicRun(`m${i}`, 'completed', 1000 + i) }
    assert.equal(store.topicRuns('trip').length, RUNS_KEPT)
    assert.equal(store.topicRuns('trip')[0].messageId, `m${RUNS_KEPT + 4}`)
    assert.equal(store.topicRun('m0'), undefined)
    // A settled run keeps its outcome; only a move (the user said it went to the wrong topic) changes it.
    store.endTopicRun(`m${RUNS_KEPT + 4}`, 'failed')
    assert.equal(store.topicRun(`m${RUNS_KEPT + 4}`)?.outcome, 'completed')
    store.endTopicRun(`m${RUNS_KEPT + 4}`, 'moved')
    assert.equal(store.topicRun(`m${RUNS_KEPT + 4}`)?.outcome, 'moved')
    store.startTopicRun('live', 'paper', 's-paper', 5000)
    store.close()

    const reopened = new ContextStore(path)
    try {
      assert.deepEqual(reopened.interruptTopicRuns(6000), ['live'])
      assert.equal(reopened.topicRun('live')?.outcome, 'interrupted')
      assert.equal(reopened.latestTopicRuns().get('paper')?.messageId, 'live')
      // Merging carries the runs over; deleting a topic removes its runs and status.
      reopened.declareTopic('paper', 'done', 7000)
      reopened.mergeTopics('paper', 'trip')
      assert.equal(reopened.topicRun('live')?.contextId, 'trip')
      assert.equal(reopened.declaredTopics().has('paper'), false)
      reopened.declareTopic('trip', 'done', 8000)
      reopened.deleteTopic('trip')
      assert.equal(reopened.topicRuns('trip').length, 0)
      assert.equal(reopened.declaredTopics().size, 0)
    } finally { reopened.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('status follows the newest run and what the user said: a new message reopens a finished topic', () => {
  assert.equal(topicStatus({ dormant: false }), 'active')
  assert.equal(topicStatus({ dormant: true }), 'dormant')
  assert.equal(topicStatus({ dormant: false, asking: true, latest: { outcome: 'running', startedAt: 1 } }), 'waiting')
  assert.equal(topicStatus({ dormant: false, latest: { outcome: 'interrupted', startedAt: 1 } }), 'waiting')
  // Cut off long ago and never taken up again: it is simply set aside.
  assert.equal(topicStatus({ dormant: true, latest: { outcome: 'interrupted', startedAt: 1 } }), 'dormant')
  assert.equal(topicStatus({ dormant: false, declaredDoneAt: 5, latest: { outcome: 'completed', startedAt: 1 } }), 'done')
  assert.equal(topicStatus({ dormant: true, declaredDoneAt: 5 }), 'done')
  assert.equal(topicStatus({ dormant: false, declaredDoneAt: 5, latest: { outcome: 'completed', startedAt: 9 } }), 'active')
  assert.equal(topicStatus({ dormant: false, declaredDoneAt: 5, latest: { outcome: 'running', startedAt: 9 } }), 'active')
})

test('a message a topic took up before a restart cut it off gets a plain notice in main chat, and is not redone', { timeout: 30000 }, async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
  const { harness, ask, textResponse, FixtureModel } = await import('./harness.ts')
  const root = await mkdtemp(join(tmpdir(), 'theone-interrupted-'))
  const model = new FixtureModel()
  let workerCalls = 0
  model.behavior = async function* () { workerCalls++; yield* textResponse('好的') }
  const app = await harness(root, model)
  try {
    await ask(app.gateway, 'Qwen 那个')
    const store = app.ctx.theone.store
    const [context] = store.contexts()
    // An ordinary reply leaves one completed run on its topic.
    assert.deepEqual(store.topicRuns(context.id).map(run => run.outcome), ['completed'])
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '论文的消融实验' }] })
    // What a background start leaves behind when the process stops before main chat gets to it.
    store.plan(message.id, app.gateway.id, 'test-gateway', { action: 'KEEP', contextId: context.id, reason: 'test' }, false)
    store.claim(message.id)
    store.startTopicRun(message.id, context.id, context.workingSessionId)
    store.interruptTopicRuns()
    const before = workerCalls
    app.gateway.followup(message)
    await app.gateway.whenIdle()
    const events = app.gateway.session.snapshotEvents()
    const end = events.findLast(event => event.type === 'turn/end')
    assert.equal(end?.type === 'turn/end' && end.data.reason.kind, 'completed')
    const reply = events.findLast(event => event.type === 'assistant/message')
    const text = reply?.type === 'assistant/message' ? reply.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') : ''
    assert.match(text, new RegExp(`重启打断了它.*「继续」`))
    assert.ok(text.includes(context.title))
    assert.equal(workerCalls, before)
    assert.equal(store.current('test-gateway'), context.id)
    assert.equal(store.topicRun(message.id)?.outcome, 'interrupted')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
