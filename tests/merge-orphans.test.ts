import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HistoryCatalog } from '../src/history-catalog.ts'
import { ContextStore } from '../src/store.ts'
import { projectBubbles } from '../src/bubble-projection.ts'
import { ask, harness } from './harness.ts'

async function setup(root: string) {
  const app = await harness(root)
  const store = app.ctx.theone.store
  const catalog = new HistoryCatalog(app.ctx, store, () => ({ provider: 'fixture', model: 'fixture' }))
  return { ...app, store, catalog, close: async () => { await catalog.close(); await app.close() } }
}

async function visible(app: Awaited<ReturnType<typeof setup>>, id: string, expected = true) {
  assert.equal(app.catalog.snapshot().contexts.find(topic => topic.id === id)?.hidden, expected ? undefined : 'orphaned')
  assert.equal((await app.catalog.candidates('继续这个话题')).some(topic => topic.id === id), expected)
  assert.equal(projectBubbles(app.store, { scope: { gatewayKey: 'test-gateway', gatewayId: app.gateway.id } })
    .topics.some(topic => topic.id === id), expected)
}

/** Simulate deletion/restoration at the session-query boundary, as in orphans.test.ts. */
function availability(app: Awaited<ReturnType<typeof setup>>) {
  const missing = new Set<string>()
  const list = app.ctx.sessionQuery.listSessions.bind(app.ctx.sessionQuery)
  app.ctx.sessionQuery.listSessions = async signal => (await list(signal)).filter(record => !missing.has(record.header.id))
  return missing
}

async function createListedSession(app: Awaited<ReturnType<typeof setup>>, sessionId: string) {
  await app.ctx.agents.create({ sessionId: SessionId(sessionId), agentOptions: { provider: 'fixture', model: 'fixture' } })
  assert.ok((await app.ctx.sessionQuery.listSessions()).some(record => record.header.id === sessionId))
}

test('merging two never-run Workers keeps the target visible and routable, including after unmerge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-orphan-'))
  const app = await setup(root)
  try {
    const source = app.store.createTopic('健身计划'), target = app.store.createTopic('周报整理')
    const worker = app.store.contexts().find(topic => topic.id === source)!.workingSessionId
    await app.catalog.refresh()
    assert.equal(app.store.indexState(worker), undefined)
    app.store.mergeTopics(source, target)
    assert.equal(app.store.indexState(worker)?.status, 'excluded')
    await app.catalog.refresh()
    await visible(app, target)
    assert.equal(app.store.unmergeTopic(source), target)
    await app.catalog.refresh()
    await visible(app, source); await visible(app, target)
    assert.equal(app.store.indexState(worker), undefined)
    assert.equal(app.model.requests.length, 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a merged target still becomes orphaned when its real Worker disappears and returns when restored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-target-gone-'))
  const app = await setup(root)
  try {
    const source = app.store.createTopic('空来源'), target = app.store.createTopic('真实目标')
    const worker = app.store.contexts().find(topic => topic.id === target)!.workingSessionId
    await createListedSession(app, worker)
    await app.catalog.refresh()
    app.store.mergeTopics(source, target)
    await app.catalog.refresh()
    await visible(app, target)
    const missing = availability(app)
    missing.add(worker)
    await app.catalog.refresh()
    await visible(app, target, false)
    app.store.unmergeTopic(source)
    await app.catalog.refresh()
    await visible(app, source); await visible(app, target, false)
    missing.clear()
    await app.catalog.refresh()
    await visible(app, target)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a real source Worker remains deletion evidence after merge, and belongs only to the source after unmerge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-source-gone-'))
  const app = await setup(root)
  try {
    const source = app.store.createTopic('真实来源'), target = app.store.createTopic('空目标')
    const worker = app.store.contexts().find(topic => topic.id === source)!.workingSessionId
    await createListedSession(app, worker)
    await app.catalog.refresh()
    app.store.mergeTopics(source, target)
    const missing = availability(app)
    missing.add(worker)
    await app.catalog.refresh()
    await visible(app, target, false)
    app.store.unmergeTopic(source)
    await app.catalog.refresh()
    await visible(app, source, false); await visible(app, target)
    missing.clear()
    await app.catalog.refresh()
    await visible(app, source)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a source first seen while excluded by a merge is remembered even after unmerge restores an empty index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-observed-'))
  let app = await setup(root)
  try {
    const source = app.store.createTopic('迟到的来源'), target = app.store.createTopic('尚未运行的目标')
    const worker = app.store.contexts().find(topic => topic.id === source)!.workingSessionId
    app.store.mergeTopics(source, target)
    await createListedSession(app, worker)
    await app.catalog.refresh()
    await visible(app, target)
    assert.equal(app.store.indexState(worker)?.status, 'excluded')
    // Closing drops the empty live session. Its observed existence must survive reopening the DB.
    await app.close()
    app = await setup(root)
    assert.ok(!(await app.ctx.sessionQuery.listSessions()).some(record => record.header.id === worker))
    await app.catalog.refresh()
    await visible(app, target, false)
    app.store.unmergeTopic(source)
    assert.equal(app.store.indexState(worker), undefined)
    await app.catalog.refresh()
    await visible(app, source, false); await visible(app, target)
    await createListedSession(app, worker)
    await app.catalog.refresh()
    await visible(app, source)
    assert.equal(app.model.requests.length, 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

for (const reason of ['archived', 'excluded'] as const) test(`an empty merged Worker does not defeat ${reason} hiding of the target's real history`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-hidden-'))
  const app = await setup(root)
  try {
    const source = app.store.createTopic('空来源'), target = app.store.createTopic('历史目标')
    const history = SessionId('11111111-1111-4111-8111-111111111111')
    await createListedSession(app, history)
    app.store.addSource(target, history, { startSeq: 0, endSeq: 5 })
    await app.catalog.refresh()
    app.store.mergeTopics(source, target)
    let archived: string[] = reason === 'archived' ? [history] : []
    app.ctx.provide('workspaceRegistry')
    app.ctx.set('workspaceRegistry', { get archivedSessionIds() { return archived } })
    if (reason === 'excluded') app.store.setCatalogExcluded('session', history, true)
    await app.catalog.refresh()
    assert.equal(app.catalog.snapshot().contexts.find(topic => topic.id === target)?.hidden, reason)
    assert.equal((await app.catalog.candidates('历史目标')).some(topic => topic.id === target), reason === 'archived')
    assert.equal(projectBubbles(app.store, { scope: { gatewayKey: 'test-gateway', gatewayId: app.gateway.id } }).topics.some(topic => topic.id === target), false)
    app.store.unmergeTopic(source)
    await app.catalog.refresh()
    await visible(app, source)
    assert.equal(app.store.hiddenReasons().get(target), reason)
    archived = []
    if (reason === 'excluded') app.store.setCatalogExcluded('session', history, false)
    await app.catalog.refresh()
    await visible(app, target)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

for (const previous of [undefined, 'ready', 'failed'] as const) test(`legacy merged records recover only false orphans (${previous ?? 'never observed'})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-upgrade-'))
  const path = join(root, 'contexts.db')
  const old = new ContextStore(path)
  const source = old.createTopic('旧来源'), target = old.createTopic('旧目标')
  const worker = old.contexts().find(topic => topic.id === source)!.workingSessionId
  if (previous) old.markIndex(worker, previous === 'ready' ? 5 : -1, previous)
  old.mergeTopics(source, target)
  old.replaceHidden([{ id: target, reason: 'orphaned' }])
  old.close()
  // Old databases have only history_index and the pre-merge row saved in the merge journal.
  const db = new DatabaseSync(path)
  db.exec('DROP TABLE IF EXISTS catalog_seen_sessions')
  db.close()
  let app = await setup(root)
  try {
    assert.equal(app.store.hiddenReasons().get(target), 'orphaned')
    await app.catalog.refresh()
    await visible(app, target, previous === undefined)
    app.store.unmergeTopic(source)
    await app.catalog.refresh()
    await visible(app, source, previous === undefined); await visible(app, target)
    await app.close()
    app = await setup(root)
    await app.catalog.refresh()
    await visible(app, source, previous === undefined); await visible(app, target)
    assert.equal(app.model.requests.length, 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('removing persisted Worker files hides a merged target and restoring the files brings it back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-disk-'))
  const sessions = join(root, 'sessions'), backup = join(root, 'detached-sessions')
  let app = await setup(root)
  try {
    const result = await ask(app.gateway, 'Qwen hardware')
    assert.equal(result.end?.data.reason.kind, 'completed')
    const target = app.store.route(result.input.id)!.decision.contextId!
    const worker = app.store.contexts().find(topic => topic.id === target)!.workingSessionId
    const log = await app.ctx.sessionQuery.readSession(SessionId(worker))
    assert.ok(log.events.length > 0)
    // This test exercises existence, not descriptor generation by the fixture model.
    app.store.markIndex(worker, log.events.at(-1)!.seq, 'ready')
    app.store.mergeTopics(app.store.createTopic('未运行的来源'), target)
    await app.catalog.refresh()
    await visible(app, target)
    await app.close()
    // Both paths are inside this test's mkdtemp root. No real user session directory is touched.
    await rename(sessions, backup)
    app = await setup(root)
    assert.ok(!(await app.ctx.sessionQuery.listSessions()).some(record => record.header.id === worker))
    await app.catalog.refresh()
    await visible(app, target, false)
    await app.close()
    await rm(sessions, { recursive: true, force: true })
    await rename(backup, sessions)
    app = await setup(root)
    assert.ok((await app.ctx.sessionQuery.listSessions()).some(record => record.header.id === worker))
    await app.catalog.refresh()
    await visible(app, target)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
