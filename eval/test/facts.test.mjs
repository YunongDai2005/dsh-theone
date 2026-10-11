import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSchedule, factState, planFactEpisodes } from '../lib/schedule.mjs'
import { buildProbes } from '../lib/probes.mjs'
import { createClient } from '../lib/llm.mjs'
import { generate } from '../generate.mjs'
import { deliveryVerdict, judgeAnswer, runSession } from '../run-facts.mjs'

const fake = join(dirname(fileURLToPath(import.meta.url)), 'fake-model.mjs')
const threads = [
  { id: 't1', facts: [{ key: 'a', value: '100', update: '90', alternative: '150' }, { key: 'b', value: 'D1', update: null, alternative: 'D2' }] },
  { id: 't2', facts: [{ key: 'c', value: 'P1', update: null, alternative: 'Q1' }] },
  { id: 't3', facts: [{ key: 'd', value: '7', update: '8', alternative: null }] },
]

test('an exchange the step check turns down, even after a rewrite, never becomes ground truth', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const root = await mkdtemp(join(tmpdir(), 'theone-check-'))
  try {
    // The fake writer, with a checker that turns every fact step down.
    const strict = join(root, 'strict.mjs')
    await writeFile(strict, `import answer from ${JSON.stringify(fake)}\nexport default async request => request.tag.startsWith('check1:') ? JSON.stringify({ ok: false }) : answer(request)\n`)
    const [session] = await generate({ sessions: 1, seed: 3, client: await createClient({ fake: strict }) })
    const steps = session.turns.filter(turn => turn.fact)
    assert.ok(steps.length > 0 && steps.every(turn => turn.tags.includes('fact-miss')))
    assert.ok(session.timeline.every(event => event.miss))
    assert.deepEqual(session.probes, [])
  } finally { await rm(root, { recursive: true, force: true }) }
  assert.equal(factState([{ thread: 't', key: 'budget', turn: 0, status: 'confirmed', value: '800', miss: true }], 't', 'budget', 0), null)
})

test('fact episodes ride on the routing plan without changing it, and every answer follows its proposal', () => {
  const plan = buildSchedule(threads, 50, 4)
  const before = JSON.stringify(plan)
  const { turns, timeline } = planFactEpisodes(plan, threads, 4)
  assert.equal(JSON.stringify(plan), before)
  assert.deepEqual(turns.map(({ i, thread, action, style }) => ({ i, thread, action, style })), plan.map(({ i, thread, action, style }) => ({ i, thread, action, style })))
  assert.deepEqual(planFactEpisodes(plan, threads, 4).timeline, timeline)
  for (const event of timeline) {
    assert.equal(turns[event.turn].thread, event.thread)
    assert.equal(turns[event.turn].fact.key, event.key)
    if (event.kind === 'accept' || event.kind === 'reject') {
      // The answer comes at the thread's next message after the proposal.
      const proposal = timeline.findLast(other => other.thread === event.thread && other.key === event.key && other.kind === 'propose' && other.turn < event.turn)
      assert.ok(proposal)
      assert.ok(!turns.some(turn => turn.thread === event.thread && turn.i > proposal.turn && turn.i < event.turn))
    }
  }
  // A fact without an alternative is never turned down.
  assert.ok(!timeline.some(event => event.thread === 't3' && event.kind === 'reject'))
})

test('the truth about a fact follows confirmations and withdrawals only', () => {
  const timeline = [
    { thread: 't1', key: 'a', turn: 2, kind: 'propose', status: 'proposed', value: '150' },
    { thread: 't1', key: 'a', turn: 3, kind: 'reject', status: 'confirmed', value: '100' },
    { thread: 't1', key: 'a', turn: 9, kind: 'update', status: 'confirmed', value: '90' },
    { thread: 't1', key: 'a', turn: 12, kind: 'retract', status: 'retracted', value: null },
  ]
  assert.deepEqual([1, 2, 3, 8, 9, 12].map(at => factState(timeline, 't1', 'a', at)), [null, null, '100', '100', '90', null])
})

test('probes are asked by a topic that exists, about another one, with the right answer at that moment', async () => {
  const client = await createClient({ fake })
  const sessions = await generate({ sessions: 4, seed: 3, client })
  let stale = 0
  for (const session of sessions) {
    assert.equal(session.version, 'interleave-v1')
    assert.ok(session.turns.every(turn => turn.assistant))
    assert.ok(session.probes.length > 0 && session.probes.length <= 8)
    for (const probe of session.probes) {
      assert.notEqual(probe.thread, probe.source)
      assert.ok(session.turns.some(turn => turn.gold.thread === probe.thread && turn.i <= probe.after))
      assert.equal(probe.gold, factState(session.timeline, probe.source, probe.key, probe.after))
      assert.ok(!probe.decoys.includes(probe.gold))
      if (probe.category === 'stale') {
        stale++
        // Asked again by the topic that asked before the change.
        assert.ok(session.probes.some(other => other.category === 'cross' && other.thread === probe.thread && other.source === probe.source && other.key === probe.key && other.after < probe.after))
      }
    }
  }
  assert.ok(stale > 0)
  // The routing set is still what it was.
  const v0 = await generate({ sessions: 1, seed: 3, client, dataset: 'v0' })
  assert.equal(v0[0].version, 'interleave-v0')
  assert.ok(!('assistant' in v0[0].turns[0]) && !('probes' in v0[0]))
})

test('answers are judged against the value at that moment; decoys say which way they went wrong', () => {
  const timeline = [
    { thread: 't1', key: '预算', turn: 1, kind: 'intro', status: 'confirmed', value: '800' },
    { thread: 't1', key: '预算', turn: 5, kind: 'update', status: 'confirmed', value: '700' },
    { thread: 't1', key: '日期', turn: 6, kind: 'propose', status: 'proposed', value: '周五' },
  ]
  const probe = { source: 't1', key: '预算', after: 6, gold: '700', decoys: ['800'] }
  assert.equal(judgeAnswer('700 元', probe, timeline), 'correct')
  assert.equal(judgeAnswer('800', probe, timeline), 'stale')
  assert.equal(judgeAnswer('原来 800，现在 700', probe, timeline), 'stale')
  assert.equal(judgeAnswer('未确定', probe, timeline), 'missing')
  assert.equal(judgeAnswer('7000', probe, timeline), 'wrong')
  const open = { source: 't1', key: '日期', after: 6, gold: null, decoys: ['周五'] }
  assert.equal(judgeAnswer('未确定', open, timeline), 'correct')
  assert.equal(judgeAnswer('Undecided.', open, timeline), 'correct')
  assert.equal(judgeAnswer('周五', open, timeline), 'proposal')
  const titles = new Map([['读书会', 't1']])
  const verdict = line => deliveryVerdict(line, { titles, timeline, at: 6 })
  assert.equal(verdict('- 【读书会】预算 = 700 元（第 2 版，用户确认于 2026-10-05 10:00 UTC）'), 'current')
  assert.equal(verdict('- 【读书会】预算：800 → 700（第 2 版）'), 'current')
  assert.equal(verdict('- 【读书会】预算 = 800（第 1 版，用户确认于 2026-10-05 10:00 UTC）'), 'stale')
  assert.equal(verdict('- 【读书会】日期 = 周五（第 1 版，用户确认于 2026-10-05 10:00 UTC）'), 'proposal')
  assert.equal(verdict('- 【读书会】预算：已撤回或目前没有确认的值，不要再使用之前的值。'), 'withdrawn')
  // The extractor's own name for a fact ("活动经费") falls back to all of the thread's facts.
  assert.equal(verdict('- 【读书会】活动经费 = 800（第 1 版，用户确认于 2026-10-05 10:00 UTC）'), 'stale')
  assert.equal(verdict('- 【读书会】活动经费 = 700（第 1 版，用户确认于 2026-10-05 10:00 UTC）'), 'current')
  assert.equal(verdict('- 【读书会】见面时间 = 周五（第 1 版，用户确认于 2026-10-05 10:00 UTC）'), 'proposal')
})

test('the facts run uses the plugin’s own flow: a careless extractor’s proposals never reach another topic', async () => {
  const client = await createClient({ fake })
  const sessions = await generate({ sessions: 3, seed: 7, client })
  const rows = (await Promise.all(sessions.map(session => runSession(session, { client, routeTurns: 4 })))).flat()
  const answers = rows.filter(row => row.kind === 'answer')
  assert.equal(answers.length, sessions.reduce((sum, session) => sum + session.probes.length, 0) * 5)
  const deliveries = rows.filter(row => row.kind === 'delivery')
  assert.ok(deliveries.length > 0)
  assert.ok(!deliveries.some(row => row.verdict === 'proposal'))
  // The extractor proposed values (the fake records every suggestion); they stayed in their topic.
  const stored = rows.filter(row => row.kind === 'session').flatMap(row => row.facts)
  assert.ok(stored.length > 0)
  assert.ok(rows.filter(row => row.kind === 'route').length > 0)
  assert.ok(!rows.some(row => row.kind === 'error'))
  const accuracy = strategy => answers.filter(row => row.strategy === strategy && row.verdict === 'correct').length
  assert.ok(accuracy('facts') > accuracy('own'))
})

test('delivery scoring checks the named fact, not an equal value belonging to another fact', () => {
  const timeline = [
    { thread: 't1', key: 'budget', turn: 1, kind: 'intro', status: 'confirmed', value: '800' },
    { thread: 't1', key: 'budget', turn: 2, kind: 'update', status: 'confirmed', value: '700' },
    { thread: 't1', key: 'headcount', turn: 2, kind: 'intro', status: 'confirmed', value: '800' },
  ]
  const input = { titles: new Map([['Club', 't1']]), timeline, at: 2 }
  assert.equal(deliveryVerdict('- 【Club】budget = 800（第 1 版）', input), 'stale')
  // A name the timeline does not know is checked against all of the thread's facts.
  assert.equal(deliveryVerdict('- 【Club】spending cap = 700（第 1 版）', input), 'current')
  assert.equal(deliveryVerdict('- 【Club】spending cap = 650（第 1 版）', input), 'unknown')
  assert.equal(judgeAnswer('未确定，也许是 700', { source: 't1', key: 'budget', after: 2, gold: '700', decoys: [] }, timeline), 'missing')
})

test('repeated probes retain facts previously delivered, including subsequent change notices', async () => {
  const session = {
    session_id: 'history', lang: 'en', threads: [
      { id: 'a', title: 'Club', description: 'Club', facts: [{ key: 'budget' }] },
      { id: 'b', title: 'Paper', description: 'Paper', facts: [] },
    ],
    turns: [
      { i: 0, text: 'budget 800', assistant: 'Got it', gold: { thread: 'a' } },
      { i: 1, text: 'Start paper', assistant: 'Got it', gold: { thread: 'b' } },
      { i: 2, text: 'budget now 700', assistant: 'Got it', gold: { thread: 'a' } },
    ],
    timeline: [
      { thread: 'a', key: 'budget', turn: 0, kind: 'intro', status: 'confirmed', value: '800' },
      { thread: 'a', key: 'budget', turn: 2, kind: 'update', status: 'confirmed', value: '700' },
    ],
    probes: [1, 1, 2, 2].map((after, n) => ({ id: `p${n}`, after, thread: 'b', source: 'a', key: 'budget',
      category: after === 1 ? 'cross' : 'stale', gold: after === 1 ? '800' : '700', decoys: after === 1 ? [] : ['800'], question: 'Paper needs Club budget' })),
  }
  const requests = []
  const client = { complete: async ({ user, tag }) => {
    const payload = JSON.parse(user)
    if (tag.startsWith('extract')) return { value: [{ label: 'budget', kind: 'fact', value: payload.user.includes('700') ? '700' : '800', evidenceQuote: payload.user }], usage: {} }
    if (tag.startsWith('route')) return { value: { action: 'EXISTING', contextId: 'b', title: null, question: null, reason: 'named', imports: (payload.symbols ?? []).map(fact => fact.id) }, usage: {} }
    requests.push(payload)
    return { value: 'undecided', usage: {} }
  } }
  await runSession(session, { client, strategies: ['facts'], routeTurns: 0 })
  assert.ok(requests[1].conversation.some(message => /budget = 800/.test(message.text)))
  assert.ok(requests[3].conversation.some(message => /800 → 700/.test(message.text)))
  assert.ok(!requests[1].conversation.some(message => /800 → 700/.test(message.text)), 'future notes must not leak into past requests')
})
