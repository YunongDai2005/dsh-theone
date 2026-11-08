import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ContextStore } from '../src/store.ts'

test('source-range reads classify sources without decoding unrelated topic descriptors', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed(['target', ...Array.from({ length: 70 }, (_, i) => `other-${i}`)].map(id =>
      ({ id, title: id, summary: 'unrelated content', entities: [], keywords: [], lastState: '' })))
    const worker = store.contexts().find(context => context.id === 'target')!.workingSessionId
    store.addSource('target', worker)
    store.addSource('target', 'history', { startSeq: 2, endSeq: 5 })
    store.addSource('target', 'history', { startSeq: 9, endSeq: 12 })
    const db = (store as unknown as { db: DatabaseSync }).db
    db.prepare('INSERT INTO context_sources VALUES (?, ?)').run('target', 'legacy')
    // Count real full-table reads while still executing them, so both the result and the cost are checked.
    const contexts = store.contexts.bind(store)
    let decoded = 0
    store.contexts = () => { const rows = contexts(); decoded += rows.length; return rows }
    assert.deepEqual(new Set(store.sourceRanges('target')), new Set([
      { sessionId: 'history', kind: 'bounded', startSeq: 2, endSeq: 5 },
      { sessionId: 'history', kind: 'bounded', startSeq: 9, endSeq: 12 },
      { sessionId: worker, kind: 'worker' }, { sessionId: 'legacy', kind: 'unscoped' },
    ]))
    assert.deepEqual(new Set(store.sources('target')), new Set(['history', worker, 'legacy']))
    assert.deepEqual(store.sourceRanges('missing'), [])
    assert.equal(decoded, 0, 'a source lookup must not decode every topic in the catalog')
  } finally { store.close() }
})

test('legacy whole-session mappings are blocked until ranges are supplied', () => {
  const root = mkdtempSync(join(tmpdir(), 'theone-migrate-'))
  const path = join(root, 'store.db')
  try {
    const initial = new ContextStore(path)
    initial.seed([{ id: 'ctx', title: 'test', summary: 'test', entities: [], keywords: [], lastState: 'test' }])
    const worker = initial.contexts()[0].workingSessionId
    initial.close()
    const old = new DatabaseSync(path)
    old.prepare('INSERT INTO context_sources VALUES (?, ?)').run('ctx', 'mixed-old-session')
    old.prepare('INSERT INTO context_sources VALUES (?, ?)').run('ctx', worker)
    old.close()
    const migrated = new ContextStore(path)
    try {
      assert.ok(migrated.sourceRanges('ctx').some(source => source.sessionId === 'mixed-old-session' && source.kind === 'unscoped'))
      assert.ok(migrated.sourceRanges('ctx').some(source => source.sessionId === worker && source.kind === 'worker'))
      assert.throws(() => migrated.addSource('ctx', 'mixed-old-session'), /explicit event range/)
      assert.throws(() => migrated.addSource('ctx', 'mixed-old-session', { startSeq: 5, endSeq: 3 }), /Invalid/)
      migrated.addSource('ctx', 'mixed-old-session', { startSeq: 10, endSeq: 20 })
      assert.ok(!migrated.sourceRanges('ctx').some(source => source.kind === 'unscoped'))
      assert.equal(migrated.sourceRanges('ctx').length, 2)
    } finally { migrated.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('catalog re-extraction keeps the Worker progress note and compaction summary', () => {
  const store = new ContextStore(':memory:')
  try {
    const parts = (fingerprint: string) => [{ seq: 0, endSeq: 4, text: '', fingerprint }]
    const topic = (contextId: string | null, summary: string, lastState: string) => ({ contextId, title: '论文', summary, entities: [], keywords: [],
      lastState, turns: [0], groupId: null, groupTitle: '研究', groupSummary: '' })
    store.importTopics('source', '/tmp', parts('a'), [topic(null, '目录摘要', '目录状态')])
    const context = store.contexts()[0]
    store.importTopics('source', '/tmp', parts('b'), [topic(context.id, '新目录摘要', '新目录状态')])
    assert.equal(store.contexts()[0].lastState, '新目录状态')
    store.updateState(context.id, 'Worker 进度', context.workingSessionId, 3)
    store.updateSummary(context.id, '压缩摘要', context.workingSessionId, 5, 6)
    store.importTopics('source', '/tmp', parts('c'), [topic(context.id, '再次目录摘要', '再次目录状态')])
    const after = store.contexts()[0]
    assert.equal(after.lastState, 'Worker 进度')
    assert.equal(after.summary, '压缩摘要')
  } finally { store.close() }
})
