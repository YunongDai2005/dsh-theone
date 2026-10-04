import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSchedule } from '../lib/schedule.mjs'
import { createClient } from '../lib/llm.mjs'
import { generate } from '../generate.mjs'
import { routeSession } from '../run-router.mjs'

const fake = join(dirname(fileURLToPath(import.meta.url)), 'fake-model.mjs')
const threads = [{ id: 't1', facts: [{ key: 'a', update: true }] }, { id: 't2', facts: [{ key: 'b' }], twinOf: 't3' }, { id: 't3', facts: [] }, { id: 't4', facts: [] }]

test('a seed always gives the same plan, and the plan is well formed', () => {
  const plan = buildSchedule(threads, 50, 3)
  assert.deepEqual(buildSchedule(threads, 50, 3), plan)
  assert.notDeepEqual(buildSchedule(threads, 50, 4), plan)
  assert.equal(plan.length, 50)
  assert.deepEqual(plan[0], { ...plan[0], thread: 't1', action: 'new' })
  // Every thread starts exactly once, before anything else is said in it.
  for (const { id } of threads) {
    const own = plan.filter(turn => turn.thread === id)
    assert.equal(own.filter(turn => turn.action === 'new').length, 1)
    assert.equal(own[0].action, 'new')
  }
  for (const turn of plan) {
    if (turn.action === 'oneoff') assert.equal(turn.thread, null)
    if (turn.action === 'return') assert.ok(turn.tags.includes('long_gap'))
    if (turn.thread === 't2' || turn.thread === 't3') assert.ok(turn.tags.includes('twin'))
    for (const ref of turn.refs) assert.notEqual(ref, turn.thread)
  }
  assert.throws(() => buildSchedule(threads, 10, 1), /Too few turns/)
})

test('the generator writes labelled sessions, and TheOne’s router replays them in both modes', async () => {
  const client = await createClient({ fake })
  const sessions = await generate({ sessions: 3, seed: 2, client })
  assert.deepEqual(sessions.map(session => session.lang), ['zh', 'en', 'zh'])
  for (const session of sessions) {
    const ids = new Set(session.threads.map(thread => thread.id))
    assert.ok(session.turns.length >= 40 && session.turns.length <= 60)
    for (const turn of session.turns) {
      assert.ok(turn.text.length > 0)
      assert.ok(turn.gold.thread === null || ids.has(turn.gold.thread))
      assert.equal(typeof turn.ambiguous, 'boolean')
    }
    for (const mode of ['closed', 'open']) {
      const rows = await routeSession(session, { mode, policy: 'theone', client })
      assert.equal(rows.length, session.turns.length)
      assert.ok(rows.every(row => row.pred !== 'ERROR'))
      if (mode === 'closed') assert.ok(rows.filter(row => ids.has(row.pred)).length > session.turns.length / 2)
      else assert.ok(rows.every(row => /^p\d+$/.test(row.pred)))
    }
  }
})

test('a malformed answer is asked again and never cached; a good one is served from cache next time', async () => {
  const { mkdtemp, writeFile, readdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'theone-eval-'))
  try {
    const flaky = join(root, 'flaky.mjs')
    await writeFile(flaky, 'let calls = 0\nexport default async () => ++calls === 1 ? "not json" : JSON.stringify({ ok: calls })\n')
    const cacheDir = join(root, 'cache')
    const client = await createClient({ fake: flaky, cacheDir })
    assert.deepEqual(await client.complete({ system: 's', user: '{}', json: true, tag: 'x' }), { ok: 2 })
    assert.equal((await readdir(cacheDir)).length, 1)
    assert.deepEqual(await client.complete({ system: 's', user: '{}', json: true, tag: 'x' }), { ok: 2 })
    assert.equal(client.usage.cached, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
