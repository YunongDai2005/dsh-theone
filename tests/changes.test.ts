import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { harness, ask, textResponse, FixtureModel } from './harness.ts'
import { ContextStore } from '../src/store.ts'

test('files a topic changed or handed over are listed under main chat\'s reply, read from the topic\'s record and numbered by main chat\'s turn', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-changes-'))
  const model = new FixtureModel()
  const app = await harness(root, model)
  let recorded: { worker: string; seq: number } | undefined
  model.behavior = async function* (options) {
    // What DSH's change recorder does at the end of the topic's turn.
    const worker = app.ctx.agents.get(SessionId(options.sessionId!))!
    const event = (worker.session as unknown as { append(type: string, data: unknown): { seq: number } }).append('workspace/changes', { turn: 1 })
    recorded = { worker: worker.id, seq: event.seq }
    // What DSH's present tool records when the topic hands over a file.
    ;(worker.session as unknown as { append(type: string, data: unknown): void }).append('deliverables/presented', { turn: 1, callId: 'call_present', files: [{ path: 'report.pdf' }] })
    yield* textResponse('改好了')
  }
  const changes = { summary: (sessionId: string, seq: number) => ({ sessionId, seq, turn: 1, cwd: '/project', files: [{ path: 'readme.txt' }] }),
    diff: async (sessionId: string, seq: number, index: number) => ({ sessionId, seq, index }) }
  app.ctx.provide('workspaceChanges'); app.ctx.set('workspaceChanges', changes)
  try {
    await ask(app.gateway, '先说点别的')
    const result = await ask(app.gateway, 'Qwen 那个改一下 readme')
    const shown = result.events.find(event => (event as { type: string }).type === 'workspace/changes')
    assert.ok(shown && recorded)
    const turn = result.events.find(event => event.type === 'turn/start')
    assert.equal((shown.data as { turn: number }).turn, turn?.type === 'turn/start' ? turn.data.turn : -1)
    assert.notEqual(app.gateway.id, recorded.worker)
    const summary = app.ctx.get('workspaceChanges') as typeof changes
    assert.deepEqual(summary.summary(app.gateway.id, shown.seq), { sessionId: recorded.worker, seq: recorded.seq, turn: 2, cwd: '/project', files: [{ path: 'readme.txt' }] })
    assert.deepEqual(await summary.diff(app.gateway.id, shown.seq, 0), { sessionId: recorded.worker, seq: recorded.seq, index: 0 })
    const presented = result.events.find(event => (event as { type: string }).type === 'deliverables/presented')
    assert.deepEqual(presented?.data, { turn: 2, callId: 'call_present', files: [{ path: 'report.pdf' }] })
    // Anything else passes through unchanged.
    assert.equal(summary.summary('other', 7).sessionId, 'other')
    // The link is kept with TheOne's records: TheOne reloaded while DSH runs on (the topic's record is
    // still there) still opens the card, and the seq may come in as text from the request.
    const reopened = new ContextStore(join(root, 'contexts.db'))
    try { assert.deepEqual(reopened.changeLink(app.gateway.id, Number(String(shown.seq))), { sessionId: recorded.worker, seq: recorded.seq, turn: 2 }) }
    finally { reopened.close() }
    assert.equal(summary.summary(app.gateway.id, String(shown.seq) as unknown as number).sessionId, recorded.worker)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
