import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '../lib/llm.mjs'
import { routeSession } from '../run-router.mjs'

const session = { session_id: 'metrics', split: 'dev', lang: 'en', threads: [{ id: 'a', title: 'A', description: '' }],
  turns: [{ i: 0, text: 'Plan a garden', gold: { thread: 'a' } }, { i: 1, text: 'ok', gold: { thread: 'a' } }] }
const create = { action: 'CREATE', contextId: null, title: 'Garden', question: null, reason: 'new', historyIndependent: true }
const makeClient = (invalid = false) => ({ complete: async ({ tag }) => tag.includes('card:')
  ? { value: { summary: 'Garden', aliases: [], entities: [], open: [] }, usage: { input: 999, output: 99, cached: 900 }, latency_ms: 999 }
  : { value: tag.includes(':recheck') ? (invalid ? {} : { ...create, reason: 'confirmed' }) : create,
    usage: { input: 100, output: 10, cached: 60 }, latency_ms: tag.includes(':recheck') ? 30 : 20 } })

test('each prediction separates quick/recheck/fast calls and excludes cards from routing usage and latency', async () => {
  const rows = await routeSession(session, { mode: 'open', policy: 'theone', client: makeClient(), recheck: true, cards: true })
  assert.deepEqual(rows.map(row => [row.tier, row.calls, row.latency_ms]), [['recheck', 2, 50], ['fast', 0, 0]])
  assert.deepEqual(rows[0].usage, { input: 200, output: 20, cache_hit: 120 })
  assert.deepEqual(rows[0].usage_by_call, [{ input: 100, output: 10, cache_hit: 60 }, { input: 100, output: 10, cache_hit: 60 }])
  assert.deepEqual(rows[1].usage_by_call, [])
  assert.equal(rows[0].card_usage[0].input, 999)
  assert.equal(typeof rows[0].elapsed_ms, 'number')
  assert.ok(rows[0].rechecked)
})

test('an invalid second answer keeps the quick tier but its tokens and latency are still counted', async () => {
  const [row] = await routeSession(session, { mode: 'open', policy: 'llm', client: makeClient(true), recheck: true })
  assert.deepEqual([row.tier, row.calls, row.latency_ms, row.usage.input], ['quick', 2, 50, 200])
  assert.equal(row.usage_by_call.length, 2)
  assert.equal(row.rechecked, undefined)
})

test('client latency excludes its concurrency queue and local cache; malformed JSON retries keep all measurements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-metrics-'))
  try {
    const fake = join(root, 'slow.mjs')
    await writeFile(fake, 'export default async () => { await new Promise(r => setTimeout(r, 45)); return "{\\"ok\\":true}" }')
    const client = await createClient({ fake, concurrency: 1, cacheDir: join(root, 'cache') })
    const started = performance.now()
    const answers = await Promise.all(['a', 'b', 'c'].map(tag => client.complete({ system: '', user: '{}', tag, json: true, details: true })))
    const elapsed = performance.now() - started
    for (const answer of answers) {
      assert.equal(answer.calls, 1)
      assert.ok(answer.latency_ms >= 35 && answer.latency_ms < elapsed * 0.75, 'queue wait must not enter model latency')
      assert.equal(answer.usage_by_call.length, 1)
    }
    const cached = await client.complete({ system: '', user: '{}', tag: 'a', json: true, details: true })
    assert.equal(cached.cached, true)
    assert.deepEqual([cached.calls, cached.latency_ms], [0, 0])
    const flaky = join(root, 'flaky.mjs')
    await writeFile(flaky, 'let n=0; export default async () => { await new Promise(r=>setTimeout(r, 10)); return ++n === 1 ? "bad" : "{\\"ok\\":true}" }')
    const retry = await (await createClient({ fake: flaky })).complete({ system: '', user: '{}', json: true, details: true })
    assert.equal(retry.calls, 2)
    assert.equal(retry.usage_by_call.length, 2)
    assert.equal(retry.usage.input, 2)
    assert.ok(retry.latency_ms >= 15)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('failed routing calls retain measurements instead of disappearing in the rules fallback', async () => {
  const client = { complete: async () => { throw Object.assign(new Error('offline failure'), { calls: 2, latency_ms: 34,
    usage: { input: 100, output: 8, cached: 25 }, usage_by_call: [{ input: 100, output: 8, cache_hit: 25 }, { input: 0, output: 0, cache_hit: 0 }] }) } }
  const [row] = await routeSession(session, { mode: 'closed', policy: 'theone', client })
  assert.deepEqual([row.calls, row.latency_ms, row.usage.cache_hit], [2, 34, 25])
  assert.equal(row.usage_by_call.length, 2)
  assert.equal(row.via, 'rules')
})
test('HTTP latency includes the complete response body but excludes EVAL_RPM pacing', async () => {
  const { createServer } = await import('node:http')
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* consume the request */ }
    response.setHeader('content-type', 'application/json')
    response.writeHead(200)
    response.flushHeaders()
    setTimeout(() => response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 60 } } })), 25)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const environment = process.env
  // Only dummy credentials, sent to this loopback fixture; no ambient API key is read.
  process.env = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, EVAL_RPM: '300' }
  try {
    const client = await createClient({ model: 'fixture', concurrency: 1 })
    await client.complete({ system: 's', user: '{}', json: true, details: true })
    const started = performance.now()
    const measured = await client.complete({ system: 's', user: '{}', json: true, details: true })
    const wall = performance.now() - started
    assert.equal(measured.calls, 1)
    assert.ok(measured.latency_ms >= 20, 'the body arrives after the headers')
    assert.ok(wall - measured.latency_ms >= 100, 'pacing is separate from request latency')
    assert.deepEqual(measured.usage_by_call, [{ input: 100, output: 12, cache_hit: 60 }])
  } finally { process.env = environment; await new Promise(resolve => server.close(resolve)) }
})

test('a rejected batch keeps its measurements before individual fallback calls, without double-counting members', async () => {
  const client = { complete: async ({ tag, user }) => {
    const batch = tag.endsWith(':each')
    const current = JSON.parse(user).currentId
    return { value: batch ? {} : current ? { action: 'EXISTING', contextId: current, title: null, question: null, reason: 'current' } : create,
      usage: { input: batch ? 40 : 100, output: batch ? 4 : 10, cached: batch ? 8 : 60 }, latency_ms: batch ? 8 : 10 }
  } }
  const rows = await routeSession(session, { mode: 'open', policy: 'llm', client, merge: 'all', decide: 'each', bursts: { same: 1 } })
  assert.deepEqual(rows.map(row => [row.calls, row.latency_ms]), [[2, 18], [1, 10]])
  assert.deepEqual(rows[0].usage_by_call.map(usage => usage.input), [40, 100])
  assert.deepEqual(rows.map(row => row.usage.input), [140, 100])
  assert.ok(rows.every(row => row.via === 'fallback-llm'))
  const joint = await routeSession(session, { mode: 'open', policy: 'llm', client, merge: 'all', bursts: { same: 1 } })
  assert.deepEqual(joint.map(row => [row.calls, row.latency_ms]), [[1, 10], [0, 0]])
  assert.equal(joint[1].usage, undefined)
})
test('a retry followed by a concurrently cached answer keeps latency already spent on the request', async () => {
  const client = { complete: async () => ({ value: create, cached: true, calls: 1, latency_ms: 17,
    usage: { input: 50, output: 5, cached: 20 }, usage_by_call: [{ input: 50, output: 5, cache_hit: 20 }] }) }
  const [row] = await routeSession({ ...session, turns: session.turns.slice(0, 1) }, { mode: 'open', policy: 'llm', client })
  assert.deepEqual([row.calls, row.latency_ms], [1, 17])
})