import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/llm.mjs'
import { routeSession } from '../run-router.mjs'
import * as schema from '../lib/routing-v1.mjs'
import * as generator from '../generate-routing-v1.mjs'

const fake = fileURLToPath(new URL('./fake-model.mjs', import.meta.url))
const topic = id => ({ id, title: id === 'a' ? 'Garden' : 'Paper', summary: 'Work in progress', entities: [], keywords: [], lastState: 'waiting' })
const turn = (i, text, thread, rest = {}) => ({ i, text, at: `2026-10-01T00:00:0${i}Z`,
  gold: { thread, action: 'continue', refs: [], explicit_binding: false, retract: [] }, tags: [], ambiguous: false, ...rest })
const session = turns => ({ session_id: 'v1-test', routing_schema: 'routing-v1', version: 'interleave-v1',
  split: 'dev', lang: 'en', threads: ['a', 'b'].map(topic), catalog: ['a', 'b'].map(topic), current_id: 'a', turns })

test('v1 validation rejects dangling references, future corrections and non-monotonic times', () => {
  const s = session([turn(0, 'ok', 'b', { input: { reply_to: 'missing' } })])
  assert.throws(() => schema.validateRoutingSession(s), /reply_to/)
  s.turns[0].input = {}
  s.turns[0].events_before = [{ type: 'correction', id: 'c', turn_i: 1, target_topic_id: 'b', text: 'wrong topic' }]
  assert.throws(() => schema.validateRoutingSession(s), /earlier turn/)
  s.turns = [turn(1, 'one', 'a'), turn(0, 'two', 'a')]
  assert.throws(() => schema.validateRoutingSession(s), /time|order/)
  assert.doesNotThrow(() => schema.validateRoutingSession({ turns: [{ i: 0, text: 'old' }] }))
})

test('deterministic bilingual cases keep pairs identical except for their declared owner and gold', () => {
  const a = generator.buildRoutingSet(), b = generator.buildRoutingSet()
  assert.deepEqual(a, b)
  assert.deepEqual([...new Set(a.map(s => s.lang))].sort(), ['en', 'zh'])
  assert.ok(a.some(s => s.catalog.length > 16))
  for (const s of a) schema.validateRoutingSession(s)
  const pairs = Map.groupBy(a.filter(s => s.pair), s => s.pair.id)
  assert.ok(pairs.size >= 24)
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2)
    assert.equal(pair[0].split, pair[1].split)
    assert.deepEqual(pair[0].turns.map(t => t.text), pair[1].turns.map(t => t.text))
    assert.notEqual(pair[0].turns.at(-1).gold.thread, pair[1].turns.at(-1).gold.thread)
    assert.deepEqual(schema.pairInvariant(pair[0]), schema.pairInvariant(pair[1]))
  }
})

test('natural generator preserves structural labels and paired short text through the fake transport', async () => {
  const source = generator.buildRoutingSet({ variants: 2 })
  const result = await generator.renderRoutingSet(source, await createClient({ fake }))
  assert.ok(source.length > 0)
  assert.equal(result.length, source.length)
  assert.ok(result.every(s => s.generation === 'model-rendered'))
  assert.deepEqual(result.map(s => s.turns.map(t => t.gold)), source.map(s => s.turns.map(t => t.gold)))
  assert.deepEqual(result.map(s => s.turns.map(t => t.events_before)), source.map(s => s.turns.map(t => t.events_before)))
  for (const pair of Map.groupBy(result.filter(s => s.pair), s => s.pair.id).values())
    assert.deepEqual(pair[0].turns.map(t => t.text), pair[1].turns.map(t => t.text))
})

test('reply and pending references use the product input endpoint without mounting gold', async () => {
  const s = session([turn(0, 'ok', 'b', { events_before: [
    { id: 'visible', type: 'foreground', topic_id: 'b', text: 'Continue?' },
    { id: 'q', type: 'pending', owner_id: 'b', kind: 'question', message_id: 'visible' },
    { id: 'bg', type: 'background', topic_id: 'a', text: 'Done', visible: false }],
    input: { reply_to: 'visible', pending_response: 'q' },
    gold: { thread: 'b', action: 'switch', refs: [], explicit_binding: true, retract: [] } })])
  const [row] = await routeSession(s, { client: await createClient({ fake }) })
  assert.equal(row.pred, 'b')
  assert.deepEqual(row.binding.unsupported, [])
  assert.equal(row.binding.applied, true)
  assert.equal(row.logical_calls, 0)
  assert.equal(row.calls, 0)
  assert.equal(row.events.filter(e => e.status === 'applied').length, 3)
  const [ablated] = await routeSession(s, { client: await createClient({ fake }), stateAblation: 'drop-bindings' })
  assert.equal(ablated.state_ablation, 'drop-bindings')
  assert.equal(ablated.pred, 'a')
  assert.equal(ablated.binding.applied, false)
})

test('correction uses the product API and retraction evidence survives a real restart', async () => {
  const s = session([turn(0, 'Garden UNIQUEPOISON', 'b'),
    turn(1, 'ok', 'b', { events_before: [{ type: 'correction', id: 'fix', turn_i: 0, target_topic_id: 'b', text: 'wrong topic' }],
      gold: { thread: 'b', action: 'continue', refs: [], explicit_binding: false,
        retract: [{ turn_i: 0, from_topic_id: 'a', markers: ['UNIQUEPOISON'] }] } }),
    turn(2, 'ok', 'b', { events_before: [{ type: 'restart', id: 'boot' }] })])
  const rows = await routeSession(s, { client: await createClient({ fake }), cards: true })
  assert.deepEqual(rows.map(r => r.pred), ['a', 'b', 'b'])
  assert.match(JSON.stringify(rows[0].state_after.topics.find(t => t.id === 'a').card), /UNIQUEPOISON/)
  assert.doesNotMatch(JSON.stringify(rows[1].state_before.topics.find(t => t.id === 'a')), /UNIQUEPOISON/)
  assert.equal(rows[1].events[0].api, '/api/theone/routes')
  assert.equal(rows[1].events[0].status, 'applied')
  assert.equal(rows[2].events[0].reused_database, true)
  assert.notEqual(rows[2].events[0].instance_before, rows[2].events[0].instance_after)
  assert.equal(rows[2].state_before.current_id, 'b')
  assert.doesNotMatch(JSON.stringify(rows[2].state_before.topics.find(t => t.id === 'a')), /UNIQUEPOISON/)
  assert.ok(rows[1].state_before.excluded.some(source => source.turn_i === 0 && source.context_id === 'a'))
})

test('same-round steering goes through the live gateway', async () => {
  const s = session([turn(0, 'Garden design', 'a'), turn(1, 'make it shorter', 'a', {
    input: { steering_of: 0 }, gold: { thread: 'a', action: 'continue', refs: [], explicit_binding: true, retract: [] } })])
  const rows = await routeSession(s, { client: await createClient({ fake }) })
  assert.equal(rows[1].delivery.kind, 'steering')
  assert.equal(rows[1].delivery.observed, true)
  assert.equal(rows[1].binding.applied, true)
  assert.equal(rows[1].receipt_missing, false)
  assert.equal(rows[1].calls, 0)
  assert.equal(rows[1].logical_calls, 0)
})

test('v1 replay refuses the legacy simulator and invalid ablation names', async () => {
  const s = session([turn(0, 'ok', 'a')])
  const client = await createClient({ fake })
  await assert.rejects(() => routeSession(s, { client, replay: 'legacy-v0' }), /routing-v1.*product-v1/)
  await assert.rejects(() => routeSession(s, { client, stateAblation: 'invented' }), /ablation/)
})

test('correction snapshots contain actual tool-written facts and remove them from the wrong topic', async () => {
  const s = generator.buildRoutingSet({ variants: 2 }).find(s => s.scenario === 'correction' && s.lang === 'en')
  const rows = await routeSession(s, { client: await createClient({ fake }), cards: true })
  const before = rows[0].state_after.topics.find(t => t.id === 'a')
  assert.equal(before.facts[0]?.value, '800')
  assert.match(JSON.stringify(before.card), /RVPOISON0/)
  const after = rows[1].state_before.topics.find(t => t.id === 'a')
  assert.deepEqual(after.facts, [])
  assert.doesNotMatch(JSON.stringify(after.card), /RVPOISON0/)
  assert.ok(rows[2].state_before.excluded.length > 0)
})

test('large catalog replay actually selects 16 candidates and executes remaining-page review', async () => {
  const s = generator.buildRoutingSet({ variants: 2 }).find(s => s.scenario === 'large_catalog')
  s.turns = s.turns.slice(0, 1)
  const requests = []
  const client = { model: 'offline-review-fixture', complete: async request => {
    const payload = JSON.parse(request.user)
    requests.push(payload)
    return { value: JSON.stringify({ action: 'CREATE', title: 'Independent work', historyIndependent: true, reason: 'fixture' }),
      calls: 1, latency_ms: 1, usage: { input: 10, output: 2 }, usage_by_call: [{ input: 10, output: 2 }] }
  } }
  const [row] = await routeSession(s, { client })
  assert.equal(row.trace.candidateIds.length, 16)
  assert.equal(row.state_before.topics.length, 24)
  assert.ok(row.call_details.some(call => call.layer === 'review'))
  assert.ok(row.trace.review.pages.flat().some(id => !row.trace.candidateIds.includes(id)))
  assert.equal(row.calls, requests.length)
})

test('natural generation fails closed on missing rows and lost fact evidence', async () => {
  const s = generator.buildRoutingSet({ variants: 2 }).find(s => s.scenario === 'correction')
  await assert.rejects(() => generator.renderRoutingSet([s], { complete: async () => ({ messages: [] }) }), /incomplete/)
  await assert.rejects(() => generator.renderRoutingSet([s], { complete: async () => ({
    messages: s.turns.map(t => ({ i: t.i, text: 'meaning was lost', reply: '' })) }) }), /lost required/)
})

test('fact generator refuses to overwrite a routing dataset before asking any model', async () => {
  const { generate } = await import('../generate.mjs')
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'routing-collision-test-'))
  const data = JSON.stringify({ routing_schema: 'routing-v1' }) + '\n'
  let called = false
  try {
    await writeFile(join(root, 'sessions.jsonl'), data)
    await assert.rejects(() => generate({ out: root, sessions: 1, client: { usage: { cost: 0 },
      complete: async () => { called = true; throw new Error('must not run') } } }), /routing-v1.*overwrite/i)
    assert.equal(called, false)
    assert.equal(await readFile(join(root, 'sessions.jsonl'), 'utf8'), data)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('mistaken CREATE cases expose keyword learning before correction and retract it afterwards', async () => {
  const s = generator.buildRoutingSet({ variants: 2 }).find(s => s.scenario === 'correction_new' && s.lang === 'en')
  assert.ok(s)
  const rows = await routeSession(s, { client: await createClient({ fake }), cards: true, mode: 'open' })
  assert.equal(rows[0].action, 'CREATE')
  const wrong = rows[0].pred
  assert.match(JSON.stringify(rows[0].state_after.topics.find(t => t.id === wrong).keywords), /RVNEW0/)
  assert.doesNotMatch(JSON.stringify(rows[1].state_before.topics.find(t => t.id === wrong).keywords), /RVNEW0/)
  assert.equal(rows[1].pred, 'b')
})

test('explicit live steering bypasses even a slow classifier and keeps its own receipt', async () => {
  const base = await createClient({ fake })
  const client = { model: base.model, complete: async request => {
    if (JSON.parse(request.user).running) await new Promise(resolve => setTimeout(resolve, 25))
    return base.complete(request)
  } }
  const s = session([turn(0, 'Garden design', 'a'), turn(1, 'make it concise', 'a', {
    input: { steering_of: 0 }, gold: { thread: 'a', action: 'continue', refs: [], explicit_binding: true, retract: [] } })])
  const rows = await routeSession(s, { client })
  assert.equal(rows[1].pred, 'a')
  assert.equal(rows[1].calls, 0)
  assert.equal(rows[1].usage_by_call.length, 0)
  assert.equal(rows[1].logical_calls, 0)
})

test('event replay preserves product fallback errors in prediction telemetry', async () => {
  const client = { model: 'offline-failure', complete: async () => { throw new Error('offline fixture unavailable') } }
  const [row] = await routeSession(session([turn(0, 'Garden design', 'a')]), { client })
  assert.equal(row.pred, 'a')
  assert.equal(typeof row.error, 'string')
  assert.ok(row.call_details.some(call => call.errorCode === row.error))
})

test('new-topic correction templates retain Chinese text instead of pipeline replacement characters', () => {
  const cases = generator.buildRoutingSet().filter(s => s.lang === 'zh' && s.scenario === 'correction_new')
  assert.equal(cases.length, 8)
  for (const s of cases) assert.match(s.turns[0].text, /\p{Script=Han}/u)
})

test('drop-user-refs removes reply and pending references but retains the server observations', async () => {
  const s = session([turn(0, 'ok', 'b', { events_before: [
    { id: 'front', type: 'foreground', topic_id: 'b', text: 'Continue?' },
    { id: 'q', type: 'pending', owner_id: 'b', kind: 'question', message_id: 'front' }],
    input: { reply_to: 'front', pending_response: 'q' } })])
  const [row] = await routeSession(s, { client: await createClient({ fake }), stateAblation: 'drop-user-refs' })
  assert.equal(row.pred, 'b')
  assert.equal(row.calls, 0)
  assert.equal(row.binding.applied, false)
  assert.deepEqual(row.binding.submitted, {})
  assert.equal(row.events.every(e => e.status === 'applied'), true)
})

test('drop-user-refs keeps native in-flight steering identity and arrival timing', async () => {
  const s = session([turn(0, 'Garden design', 'a'), turn(1, 'make it shorter', 'a', { input: { steering_of: 0 } })])
  const rows = await routeSession(s, { client: await createClient({ fake }), stateAblation: 'drop-user-refs' })
  assert.equal(rows[1].delivery.kind, 'steering')
  assert.equal(rows[1].delivery.observed, true)
  assert.equal(rows[1].binding.applied, true)
  assert.equal(rows[1].calls, 0)
})

test('step7 templates provide unmarked unique waits and identifiable distant catalog targets', () => {
  const data = generator.buildRoutingSet()
  for (const s of data) {
    if (['question', 'approval'].includes(s.scenario)) {
      const events = s.turns[0].events_before
      assert.equal(events.filter(e => e.type === 'pending').length, 1)
      assert.ok(!events.some(e => e.type === 'foreground' && e.topic_id !== s.turns[0].gold.thread))
    }
    if (s.scenario === 'large_catalog') {
      const last = s.turns.at(-1)
      assert.equal(last.ambiguous, false)
      assert.ok(last.text.includes(s.catalog.find(c => c.id === 'c23').entities[1]))
    }
  }
  assert.ok(data.some(s => s.scenario === 'question_conflict' && s.turns[0].gold.requires_user_ref))
})
