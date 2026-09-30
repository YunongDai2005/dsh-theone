// Read an isolated test profile using the official DSH query/persistence services.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'

export async function verifyWorkerEvidence(root, runtime) {
  const db = new DatabaseSync(join(root, 'contexts.db'), { readOnly: true })
  const module = name => import(pathToFileURL(join(runtime, `node_modules/@deepseek-ai/${name}/lib/index.js`)))
  const { Context } = await module('cordis')
  const sessions = await module('dsh-session'), persistence = await module('dsh-session-persistence-jsonl'), query = await module('dsh-session-query-sqlite')
  const ctx = new Context()
  try {
    const gpu = db.prepare("SELECT working_session_id FROM contexts WHERE id = 'gpu'").get().working_session_id
    const paper = db.prepare("SELECT working_session_id FROM contexts WHERE id = 'paper'").get().working_session_id
    await ctx.plugin(sessions.default)
    await ctx.plugin(persistence.default, { root: join(root, 'home/sessions') })
    await ctx.plugin(query.default, { path: ':memory:' })
    const worker = await ctx.sessionQuery.readSession(sessions.SessionId(gpu))
    assert.equal(worker.session.cwd, join(root, 'workspace'))
    const calls = worker.events.filter(e => e.type === 'tool/call' && e.data.name === 'theone_search_history')
    assert.ok(calls.length > 0, 'Real Worker never called history tool')
    const results = worker.events.filter(e => e.type === 'tool/result' && calls.some(c => c.data.callId === e.data.message.toolCallId))
    assert.equal(results.length, calls.length, 'History calls and results do not pair')
    for (const result of results) {
      assert.equal(result.data.message.isError, false, 'History tool returned an error')
      const value = JSON.parse(result.data.message.content.filter(b => b.type === 'text').map(b => b.text).join(''))
      assert.equal(value.contextId, 'gpu')
      assert.equal(value.referenceOnly, true)
      assert.ok(value.windows.every(w => w.sessionId !== paper), 'Another Context’s source was retrieved')
      assert.ok(value.windows.some(w => w.excerpts.some(e => e.text.includes('GPU_ORANGE_731'))), 'Test marker absent from history result')
    }
    for (const record of await ctx.sessionQuery.listSessions()) {
      const log = await ctx.sessionQuery.readSession(record.header.id)
      for (const event of log.events) if (event.type === 'tool/call') assert.ok(['theone_search_history', 'theone_update_state'].includes(event.data.name))
    }
    return { check: 'history-tool', passed: true, calls: calls.length, sourceIsolation: true, workspaceInitialized: true, unrelatedToolsExecuted: false }
  } finally { db.close(); await ctx.fiber.dispose() }
}
