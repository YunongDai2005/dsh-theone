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

test('an OpenAI-compatible endpoint works too: chat/completions, bearer key, usage with cached tokens', async () => {
  const { createServer } = await import('node:http')
  const answer = (await import(fake)).default
  const seen = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    const body = JSON.parse(raw)
    seen.push({ url: request.url, auth: request.headers.authorization, body })
    const [system, user] = body.messages
    const text = await answer({ system: system.content, user: user.content, tag: system.content.includes('label which work thread') ? 'judge' : system.content.includes('design realistic test data') ? 'spec' : 'render' })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 600 } } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const saved = { ...process.env }
  Object.assign(process.env, { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1/`, EVAL_EXTRA_BODY: '{"stream":false}' })
  delete process.env.DEEPSEEK_API_KEY
  try {
    const client = await createClient({ model: 'some-model' })
    const sessions = await generate({ sessions: 1, seed: 5, client })
    assert.equal(sessions.length, 1)
    assert.ok(seen.length > 3)
    assert.ok(seen.every(call => call.url === '/v1/chat/completions' && call.auth === 'Bearer test-key'))
    assert.ok(seen.every(call => call.body.model === 'some-model' && call.body.messages[0].role === 'system' && call.body.stream === false && !('thinking' in call.body)))
    assert.equal(client.usage.input, seen.length * 1000)
    assert.equal(client.usage.cacheHit, seen.length * 600)
    // Without a model name an OpenAI-compatible provider is refused up front.
    await assert.rejects(createClient({}), /--model/)
  } finally {
    process.env = saved
    server.close()
  }
})

test('each routed message carries its own tokens even when sessions run concurrently', async () => {
  const client = await createClient({ fake, concurrency: 4 })
  const sessions = await generate({ sessions: 3, seed: 9, client: await createClient({ fake }) })
  const rows = (await Promise.all(sessions.map(session => routeSession(session, { mode: 'open', policy: 'llm', client })))).flat()
  // Deltas of a shared running total would count other sessions' calls and add up to far more.
  assert.equal(rows.reduce((sum, row) => sum + row.usage.input, 0), client.usage.input)
  assert.ok(rows.every(row => row.via === 'llm' && row.usage.input > 0))
})
