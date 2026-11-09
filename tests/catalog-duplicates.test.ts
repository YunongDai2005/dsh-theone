import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ContextStore } from '../src/store.ts'
import type { ExtractedTopic } from '../src/catalog-types.ts'

const part = (seq = 9, endSeq = 20, fingerprint = 'initial') => ({ seq, endSeq, fingerprint, text: '女孩' })
const topic = (contextId: string | null = null, turns = [9]): ExtractedTopic => ({ contextId, turns,
  title: '女孩', summary: '用户只输入了女孩，意图待澄清', entities: [], keywords: ['女孩'], lastState: '待澄清',
  groupId: null, groupTitle: '待归类', groupSummary: '' })
const dbOf = (store: ContextStore) => (store as unknown as { db: DatabaseSync }).db
const importOne = (store: ContextStore, session = 'history') => {
  store.importTopics(session, '/project', [part()], [topic()])
  return store.indexedTurn(session, 9)!.contextId
}
// Reconstruct an old catalog row that already lost its last range, without relying on the bug.
function legacyOrphan(store: ContextStore, id: string, session = 'history') {
  store.seed([{ id, title: id, summary: '用户只输入了女孩，意图待澄清', entities: [], keywords: ['女孩'], lastState: '待澄清' }])
  dbOf(store).prepare('INSERT INTO context_origins VALUES (?, ?, ?)').run(id, session, '/project')
  return store.contexts().find(c => c.id === id)!
}

test('null re-extraction keeps the same owner and replaces its range repeatedly, including archived owners', () => {
  const store = new ContextStore(':memory:')
  try {
    const id = importOne(store)
    store.replaceHidden([{ id, reason: 'archived' }])
    for (let end = 21; end < 26; end++) {
      store.importTopics('history', '/project', [part(9, end, `changed-${end}`)], [topic()])
      assert.equal(store.contexts().length, 1)
      assert.equal(store.indexedTurn('history', 9)?.contextId, id)
      assert.deepEqual(store.sourceRanges(id), [{ sessionId: 'history', kind: 'bounded', startSeq: 9, endSeq: end }])
      assert.equal(store.hiddenReasons().get(id), 'archived')
    }
  } finally { store.close() }
})

test('one null topic spanning different owners preserves each owner and groups only unowned turns together', () => {
  const store = new ContextStore(':memory:')
  try {
    store.importTopics('history', undefined, [part(9, 19), part(20, 29)], [topic(null, [9]), topic(null, [20])])
    const a = store.indexedTurn('history', 9)!.contextId, b = store.indexedTurn('history', 20)!.contextId
    store.importTopics('history', undefined, [part(9, 19, 'new'), part(20, 29, 'new'), part(30, 39), part(40, 49)], [topic(null, [9, 20, 30, 40])])
    assert.equal(store.contexts().length, 3)
    assert.equal(store.indexedTurn('history', 9)?.contextId, a)
    assert.equal(store.indexedTurn('history', 20)?.contextId, b)
    assert.equal(store.indexedTurn('history', 30)?.contextId, store.indexedTurn('history', 40)?.contextId)
    assert.ok(![a, b].includes(store.indexedTurn('history', 30)!.contextId))
  } finally { store.close() }
})

test('an explicit existing destination moves the turn and reversibly retires its empty catalog owner without inventing a Worker source', () => {
  const store = new ContextStore(':memory:')
  try {
    const old = importOne(store), worker = store.contexts()[0].workingSessionId
    const target = store.createTopic('目标')
    const before = store.contexts().find(c => c.id === old)
    store.importTopics('history', undefined, [part(9, 21, 'new')], [topic(target)])
    assert.equal(store.indexedTurn('history', 9)?.contextId, target)
    assert.ok(!store.contexts().some(c => c.id === old))
    assert.deepEqual(store.merges().map(m => [m.sourceId, m.targetId]), [[old, target]])
    assert.deepEqual(store.sources(target), ['history'])
    assert.equal(store.indexState(worker), undefined)
    store.unmergeTopic(old)
    assert.deepEqual(store.contexts().find(c => c.id === old), before)
    assert.equal(store.indexedTurn('history', 9)?.contextId, target, 'undoing retirement does not undo explicit turn ownership')
  } finally { store.close() }
})

test('moving just part of a catalog topic keeps its remaining history', () => {
  const store = new ContextStore(':memory:')
  try {
    store.importTopics('history', undefined, [part(9, 19), part(20, 29)], [topic(null, [9, 20])])
    const old = store.indexedTurn('history', 9)!.contextId, target = store.createTopic('目标')
    store.importTopics('history', undefined, [part(9, 19, 'new')], [topic(target)])
    assert.ok(store.contexts().some(c => c.id === old))
    assert.deepEqual(store.sourceRanges(old), [{ sessionId: 'history', kind: 'bounded', startSeq: 20, endSeq: 29 }])
    assert.deepEqual(store.merges(), [])
  } finally { store.close() }
})

const protections: Record<string, (store: ContextStore, id: string) => void> = {
  route: (s, id) => { s.plan('r', 'gateway', 'key', { action: 'MOUNT', contextId: id, reason: 'test' }) },
  'previous route': (s, id) => { s.learningJournal.source('previous', id) },
  'Worker run': (s, id) => { s.startTopicRun('w', id, s.contexts().find(c => c.id === id)!.workingSessionId) },
  'Worker session': (s, id) => s.rememberCatalogSessions([s.contexts().find(c => c.id === id)!.workingSessionId]),
  'Worker events': (s, id) => s.updateState(id, '完成', s.contexts().find(c => c.id === id)!.workingSessionId, 12),
  rename: (s, id) => s.editTopic(id, { title: '用户命名' }),
  summary: (s, id) => s.editTopic(id, { summary: '用户编辑摘要' }),
  group: (s, id) => s.moveTopic(id, { title: '用户分组' }),
  privacy: (s, id) => s.setPrivate(id, true),
  constraints: (s, id) => s.setConstraints(id, '用户规则'),
  'manual link': (s, id) => s.setManualLink(id, s.createTopic('关联话题'), 1),
  'briefing reader': (s, id) => s.markSeen(id, s.createTopic('摘要来源'), 10),
  merge: (s, id) => s.markOnce(`merge-handled:${id}`),
}
for (const [name, protect] of Object.entries(protections)) test(`catalog retirement preserves a topic with ${name}`, () => {
  const store = new ContextStore(':memory:')
  try {
    const id = importOne(store), target = store.createTopic('目标')
    protect(store, id)
    store.importTopics('history', undefined, [part(9, 21, 'changed')], [topic(target)])
    assert.equal(store.indexedTurn('history', 9)?.contextId, target)
    assert.ok(store.contexts().some(c => c.id === id))
    store.markIndex('history', 21, 'ready')
    store.repairCatalogOrphans()
    assert.ok(store.contexts().some(c => c.id === id))
    assert.ok(!store.merges().some(m => m.sourceId === id))
  } finally { store.close() }
})

test('legacy catalog repair is atomic, once-only across restarts, and its merges remain undoable', () => {
  const root = mkdtempSync(join(tmpdir(), 'theone-catalog-repair-')), path = join(root, 'contexts.db')
  let store = new ContextStore(path)
  try {
    const owner = importOne(store)
    store.markIndex('history', 20, 'ready')
    store.replaceHidden([{ id: owner, reason: 'archived' }])
    const first = legacyOrphan(store, 'orphan-1'), second = legacyOrphan(store, 'orphan-2')
    const before = store.contexts()
    dbOf(store).exec("CREATE TRIGGER fail_repair BEFORE DELETE ON contexts WHEN old.id='orphan-2' BEGIN SELECT RAISE(ABORT,'repair test'); END")
    assert.throws(() => store.repairCatalogOrphans(), /repair test/)
    assert.deepEqual(store.contexts(), before)
    assert.deepEqual(store.merges(), [])
    dbOf(store).exec('DROP TRIGGER fail_repair')
    assert.equal(store.repairCatalogOrphans().length, 2)
    assert.deepEqual(store.contexts().map(c => c.id), [owner])
    assert.equal(store.hiddenReasons().get(owner), 'archived')
    assert.deepEqual(store.sources(owner), ['history'])
    assert.deepEqual(store.repairCatalogOrphans(), [])
    store.close(); store = new ContextStore(path)
    assert.deepEqual(store.repairCatalogOrphans(), [])
    assert.equal(store.unmergeTopic(first.id), owner)
    assert.equal(store.unmergeTopic(second.id), owner)
    assert.deepEqual(store.contexts().find(c => c.id === first.id), first)
    assert.deepEqual(store.contexts().find(c => c.id === second.id), second)
    assert.deepEqual(store.repairCatalogOrphans(), [])
    assert.equal(store.contexts().length, 3)
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('legacy repair leaves ambiguous multi-topic sessions, missing owners and unfinished indexes alone', () => {
  const store = new ContextStore(':memory:')
  try {
    store.importTopics('mixed', undefined, [part(9, 19), part(20, 29)], [topic(null, [9]), topic(null, [20])])
    store.markIndex('mixed', 29, 'ready')
    legacyOrphan(store, 'ambiguous', 'mixed')
    legacyOrphan(store, 'no-owner', 'absent')
    importOne(store, 'incomplete')
    store.markIndex('incomplete', -1, 'failed')
    legacyOrphan(store, 'unfinished', 'incomplete')
    const count = store.contexts().length
    assert.deepEqual(store.repairCatalogOrphans(), [])
    assert.equal(store.contexts().length, count)
  } finally { store.close() }
})

test('another Worker reading a catalog summary is not that catalog topic having its own Worker activity', () => {
  const store = new ContextStore(':memory:')
  try {
    const owner = importOne(store), orphan = legacyOrphan(store, 'read-only-summary')
    store.markIndex('history', 20, 'ready')
    const reader = store.createTopic('读者')
    store.markSeen(reader, orphan.id, 123)
    assert.deepEqual(store.repairCatalogOrphans().map(r => r.sourceId), [orphan.id])
    assert.ok(!store.contexts().some(c => c.id === orphan.id))
    store.unmergeTopic(orphan.id)
    assert.deepEqual(store.contexts().find(c => c.id === orphan.id), orphan)
    assert.deepEqual({ ...dbOf(store).prepare('SELECT * FROM briefing_seen WHERE reader = ? AND source = ?').get(reader, orphan.id) },
      { reader, source: orphan.id, seen_at: 123 })
    assert.deepEqual(store.sources(owner), ['history'])
  } finally { store.close() }
})

test('catalog import rolls back ownership, descriptors and retirement when a merge fails', () => {
  const store = new ContextStore(':memory:')
  try {
    const old = importOne(store), target = store.createTopic('目标')
    const before = store.contexts(), ranges = store.sourceRanges(old)
    dbOf(store).exec("CREATE TRIGGER fail_retirement BEFORE DELETE ON contexts BEGIN SELECT RAISE(ABORT,'retirement test'); END")
    assert.throws(() => store.importTopics('history', undefined, [part(9, 21, 'new')], [topic(target)]), /retirement test/)
    assert.deepEqual(store.contexts(), before)
    assert.deepEqual(store.sourceRanges(old), ranges)
    assert.equal(store.indexedTurn('history', 9)?.contextId, old)
    assert.deepEqual(store.sources(target), [])
    assert.deepEqual(store.merges(), [])
  } finally { store.close() }
})

test('a route-created topic with a project origin is never retired as a catalog orphan', () => {
  const store = new ContextStore(':memory:')
  try {
    const route = store.plan('create', 'gateway', 'key', { action: 'CREATE', title: '路由话题', folder: '/project', reason: 'test' })
    const id = route.decision.contextId!, target = store.createTopic('目标')
    store.importTopics('history', undefined, [part()], [topic(id)])
    store.importTopics('history', undefined, [part(9, 21, 'new')], [topic(target)])
    store.markIndex('history', 21, 'ready')
    store.repairCatalogOrphans()
    assert.ok(store.contexts().some(c => c.id === id))
    assert.deepEqual(store.merges(), [])
  } finally { store.close() }
})

test('route corrections do not invalidate already handled exclusions in unrelated sessions again', () => {
  const store = new ContextStore(':memory:')
  try {
    const a = store.createTopic('甲'), b = store.createTopic('乙')
    store.learningJournal.bind('worker-a', 'input', 'wrong', a, 0)
    store.learningJournal.end('worker-a', 'input', 8)
    store.markIndex('worker-a', 8, 'ready')
    store.reassignLearning('wrong', b)
    assert.equal(store.indexState('worker-a')?.throughSeq, -1)
    store.markIndex('worker-a', 8, 'ready')
    store.reassignLearning('unrelated', b)
    assert.equal(store.indexState('worker-a')?.throughSeq, 8)
  } finally { store.close() }
})
