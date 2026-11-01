import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createClient } from '../lib/llm.mjs'
import { routeSession, validatePredictionKeys } from '../run-router.mjs'
const fake = fileURLToPath(new URL('./fake-model.mjs', import.meta.url))
const session = { session_id: 'product', threads: [{ id: 'a', title: 'Garden', description: 'Planning a garden' }],
  turns: [{ i: 0, text: 'Garden design', gold: { thread: 'a' } }, { i: 1, text: 'ok', gold: { thread: 'a' } }] }

test('product replay executes the real fast path and writes complete unique predictions', async () => {
  const client = await createClient({ fake })
  const rows = await routeSession(session, { mode: 'closed', client })
  assert.deepEqual(rows.map(row => [row.pred, row.calls]), [['a', 1], ['a', 0]])
  assert.ok(rows.every(row => row.replay === 'product-v1' && row.trace.final.contextId === row.pred))
  assert.deepEqual(rows[0].usage_by_call.map(call => call.layer), ['quick'])
  assert.equal(typeof rows[0].usage_by_call[0].latency_ms, 'number')
  assert.throws(() => validatePredictionKeys([session], rows.slice(1)), /Missing prediction/)
  assert.throws(() => validatePredictionKeys([session], [...rows, rows[0]]), /Duplicate prediction/)
  assert.throws(() => validatePredictionKeys([session], [...rows, { ...rows[0], i: 20 }]), /Unexpected prediction/)
})

test('open product replay creates a real topic, rechecks and restores it for the next turn', async () => {
  const rows = await routeSession(session, { mode: 'open', client: await createClient({ fake }), cards: true })
  assert.equal(rows[0].action, 'CREATE')
  assert.equal(rows[1].pred, rows[0].pred)
  assert.deepEqual(rows[0].usage_by_call.map(call => call.layer), ['quick', 'recheck'])
  assert.equal(rows[1].calls, 0)
  assert.ok(rows[0].card_usage.length > 0, 'actual product card work is counted separately')
})

test('every transport attempt retains its own layer, tokens and duration', async () => {
  const client = { model: 'fixture', complete: async () => ({ value: JSON.stringify({ action: 'EXISTING', contextId: 'a', reason: 'named' }),
    calls: 2, latency_ms: 10, latency_by_call: [4, 6], usage: { input: 30, cached: 12, output: 3 },
    usage_by_call: [{ input: 10, cache_hit: 2, output: 1 }, { input: 20, cache_hit: 10, output: 2 }] }) }
  const [row] = await routeSession({ ...session, turns: session.turns.slice(0, 1) }, { client })
  assert.equal(row.logical_calls, 1)
  assert.equal(row.calls, 2)
  assert.deepEqual(row.usage_by_call, [
    { layer: 'quick', input: 10, cache_hit: 2, output: 1, latency_ms: 4 },
    { layer: 'quick', input: 20, cache_hit: 10, output: 2, latency_ms: 6 }])
})

test('legacy experiments are explicitly labelled and cannot silently replace the product policy', async () => {
  const client = await createClient({ fake })
  await assert.rejects(() => routeSession(session, { policy: 'llm', client }), /legacy-v0/)
  const rows = await routeSession(session, { replay: 'legacy-v0', mode: 'closed', policy: 'llm', client })
  assert.ok(rows.every(row => row.replay === 'legacy-v0'))
})

test('correction replay records its candidates and lets real correction learning update the next request', async () => {
  const requests = []
  const client = { model: 'fixture', complete: async request => {
    const payload = JSON.parse(request.user)
    requests.push(payload)
    const value = payload.rightTopic ? ['Qwen'] : { action: 'EXISTING', contextId: requests.length === 1 ? 'a' : 'b', reason: 'fixture' }
    return { value: JSON.stringify(value), calls: 1, latency_ms: 2, usage: { input: 10, output: 3, cached: 2 },
      usage_by_call: [{ input: 10, output: 3, cache_hit: 2 }] }
  } }
  const rows = await routeSession({ session_id: 'correction', threads: [
    { id: 'a', title: 'Inference', description: 'Model setup' }, { id: 'b', title: 'Paper', description: 'Research writing' }],
    turns: [{ i: 0, text: 'Qwen 的显存设置' }, { i: 1, text: '分错了，是论文的' }, { i: 2, text: 'Qwen 的显存设置需要继续调整' }] }, { client })
  assert.equal(rows[1].pred, 'b')
  assert.deepEqual(rows[1].trace.candidateIds, ['b'])
  assert.equal(rows[1].trace.initial.contextId, 'b')
  assert.deepEqual(rows[1].auxiliary_usage, [{ layer: 'terms', input: 10, output: 3, cache_hit: 2, latency_ms: 2 }])
  const last = requests.at(-1)
  assert.ok(last.contexts.find(context => context.id === 'b').keywords.includes('Qwen'))
})