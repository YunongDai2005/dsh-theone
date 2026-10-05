import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ContextStore } from '../src/store.ts'
// @ts-expect-error plain JS script without types
import { readRoutes, routeStats } from '../scripts/route-stats.mjs'

test('route statistics count bursts, topic changes and unrouted steering without printing any text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-route-stats-'))
  try {
    const dbPath = join(root, 'theone', 'contexts.db')
    const store = new ContextStore(dbPath)
    store.seed([{ id: 'a', title: '秘密标题A', summary: '', entities: [], keywords: [], lastState: '' }, { id: 'b', title: '秘密标题B', summary: '', entities: [], keywords: [], lastState: '' }])
    const keep = (id: string, contextId: string, reason: string) => store.plan(id, 'gw', 'key', { action: 'KEEP', contextId, reason })
    keep('m1', 'a', 'model decided'); keep('m2', 'a', 'short-continuation'); keep('m4', 'b', 'model decided'); keep('m5', 'b', 'steering')
    store.recordRouteDetail('m5', '秘密内容', {})
    store.correctRoute('m5', 'a')
    store.close()
    // Main chat log: m3 was typed during a reply and handed straight to it (never routed).
    const t0 = 1_700_000_000_000
    const log = [[ 'm1', 0 ], [ 'm2', 2_000 ], [ 'm3', 4_000 ], [ 'm4', 60_000 ], [ 'm5', 62_000 ]]
      .map(([id, at], seq) => JSON.stringify({ type: 'user/message', seq, time: t0 + Number(at), data: { id, role: 'user', content: [{ type: 'text', text: '秘密内容' }], source: { kind: 'user' } } }))
    await mkdir(join(root, 'sessions', 'project', 'gw'), { recursive: true })
    await writeFile(join(root, 'sessions', 'project', 'gw', 'session.v3.jsonl'), log.join('\n') + '\n')

    const routes = readRoutes(dbPath)
    assert.equal(routes.length, 4)
    const stats = routeStats(routes, new Map([['gw', join(root, 'sessions', 'project', 'gw', 'session.v3.jsonl')]]))
    assert.deepEqual([stats.mainChat.userMessages, stats.mainChat.notRouted], [5, 1])
    assert.deepEqual(stats.reasons.steering, { routes: 1, corrected: 1, correctedShare: 1 })
    assert.equal(stats.reasons.model.routes, 2)
    // Pairs within 3 s: m1→m2, m2→m3, m4→m5; m3 was not routed. m5 was kept with b as steering but
    // you moved it to a: by where they belong, that burst changed subject.
    assert.equal(stats.consecutive.byGap['<=3s'].pairs, 3)
    assert.equal(stats.consecutive.byGap['<=3s'].bothRouted, 2)
    assert.equal(stats.consecutive.byGap['<=3s'].topicChanged, 0.5)
    assert.equal(stats.consecutive.topicChanged, 0.5)

    // The command prints numbers only: no titles, no text.
    const out = execFileSync(process.execPath, ['scripts/route-stats.mjs', '--db', dbPath, '--sessions', join(root, 'sessions')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    assert.match(out, /路由记录 4 条/)
    assert.doesNotMatch(out, /秘密/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
