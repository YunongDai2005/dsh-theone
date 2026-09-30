import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ContextStore } from '../src/store.ts'

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
