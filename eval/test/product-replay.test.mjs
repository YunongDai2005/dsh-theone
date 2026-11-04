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
test('router retries retain per-attempt telemetry and failure diagnostics in product predictions', async () => {
  let n = 0
  const client = { model: 'fixture', complete: async () => ({ value: ++n === 1 ? 'private malformed JSON' : JSON.stringify({ action: 'EXISTING', contextId: 'a', reason: 'named' }),
    calls: 1, latency_ms: 4, usage: { input: 17, cached: 7, output: 3 }, usage_by_call: [{ input: 17, cache_hit: 7, output: 3 }] }) }
  const [row] = await routeSession({ ...session, turns: session.turns.slice(0, 1) }, { client })
  assert.equal(row.pred, 'a')
  assert.equal(row.logical_calls, 2)
  assert.equal(row.calls, 2)
  assert.deepEqual(row.call_details.map(c => [c.layer, c.attempt, c.errorCode]), [['quick', 1, 'ROUTER_INVALID_JSON'], ['quick', 2, undefined]])
  assert.deepEqual(row.usage, { input: 34, output: 6, cache_hit: 14 })
  assert.deepEqual(row.error_detail, { code: 'ROUTER_INVALID_JSON', detail: 'json-parse' })
  assert.equal(row.trace.retries[0].attempts, 2)
  assert.ok(!JSON.stringify(row).includes('private malformed'))
})

test('exhausted router retries expose the final semantic failure on a rules fallback', async () => {
  let n = 0
  const client = { model: 'fixture', complete: async () => ({ value: ++n === 1 ? 'broken JSON' : JSON.stringify({ action: 'EXISTING', contextId: 'unknown', reason: 'named' }),
    calls: 1, latency_ms: 4, usage: { input: 17, cached: 7, output: 3 }, usage_by_call: [{ input: 17, cache_hit: 7, output: 3 }] }) }
  const [row] = await routeSession({ ...session, turns: session.turns.slice(0, 1) }, { client })
  assert.equal(row.calls, 2)
  assert.equal(row.error, 'ROUTER_INVALID_DECISION')
  assert.deepEqual(row.error_detail, { code: 'ROUTER_INVALID_DECISION', detail: 'unknown-context-id' })
  assert.deepEqual(row.usage, { input: 34, output: 6, cache_hit: 14 })
})

test('concurrent review retry telemetry keeps transport order, candidates and per-call tokens aligned', async () => {
  const catalog = Array.from({ length: 55 }, (_, i) => ({ id: `old-${String(i).padStart(3, '0')}`, title: `Unrelated project ${i}`, summary: 'An old independent project', entities: [], keywords: [], lastState: 'waiting' }))
  const requests = [], counts = new Map()
  const client = { model: 'fixture', complete: async request => {
    const p = JSON.parse(request.user), ids = p.contexts.map(c => c.id)
    const n = requests.length + 1
    requests.push(ids)
    const key = ids.join(',')
    counts.set(key, (counts.get(key) ?? 0) + 1)
    const review = n > 2 && !p.recheck
    const firstReview = review && ids.includes('old-016')
    if (firstReview) await new Promise(r => setTimeout(r, 20))
    const value = firstReview && counts.get(key) === 1 ? 'broken JSON' : firstReview
      ? { action: 'EXISTING', contextId: 'old-016', reason: 'found' }
      : { action: 'CREATE', title: 'Pottery', reason: 'new', historyIndependent: true }
    return { value: typeof value === 'string' ? value : JSON.stringify(value), calls: 1, latency_ms: n,
      usage: { input: n * 10, cached: n, output: n }, usage_by_call: [{ input: n * 10, cache_hit: n, output: n }] }
  } }
  const [row] = await routeSession({ session_id: 'parallel-retry', catalog, threads: [], turns: [{ i: 0, text: 'Could we pick up that old project again?' }] }, { client })
  assert.equal(row.pred, 'old-016')
  assert.equal(row.calls, 6)
  assert.equal(row.logical_calls, 6)
  assert.deepEqual(row.call_details.map(c => c.candidateIds), requests)
  assert.deepEqual(row.call_details.map(c => c.promptTokens), [10, 20, 30, 40, 50, 60])
  assert.deepEqual(row.usage_by_call.map(c => c.input), [10, 20, 30, 40, 50, 60])
  assert.deepEqual(row.call_details.map(c => c.attempt), [1, 1, 1, 1, 1, 2])
  assert.deepEqual(row.usage, { input: 210, output: 21, cache_hit: 21 })
  assert.deepEqual(row.trace.retries.map(r => [r.layer, r.attempts]), [['review', 2]])
})

test('a failed correction keeps its final validation detail in the prediction', async () => {
  let n = 0
  const client = { model: 'fixture', complete: async request => {
    const value = request.tag.startsWith('terms:') ? [] : { action: 'EXISTING', contextId: ++n === 1 ? 'a' : 'unknown', reason: 'named' }
    return { value: JSON.stringify(value), calls: 1, latency_ms: 1, usage: { input: 17, cached: 7, output: 3 }, usage_by_call: [{ input: 17, cache_hit: 7, output: 3 }] }
  } }
  const rows = await routeSession({ session_id: 'correction-failure', threads: [
    { id: 'a', title: 'Inference', description: 'Model setup' }, { id: 'b', title: 'Paper', description: 'Research writing' }],
    turns: [{ i: 0, text: 'Qwen memory settings' }, { i: 1, text: 'wrong topic, it is the Paper one' }] }, { client })
  assert.equal(rows[1].calls, 2)
  assert.deepEqual(rows[1].error_detail, { code: 'ROUTER_INVALID_DECISION', detail: 'unknown-context-id' })
})
