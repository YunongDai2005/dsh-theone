import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeSession } from '../run-router.mjs'
import fake from './fake-model.mjs'
const session = { session_id: 'cache-test', threads: [{ id: 'long-topic-identifier-garden', title: 'Garden', description: 'Planning a garden' }],
  turns: [{ i: 0, text: 'Garden layout with a pond', gold: { thread: 'long-topic-identifier-garden' } },
    { i: 1, text: 'Garden layout with a wider path', gold: { thread: 'long-topic-identifier-garden' } }] }
async function replay(options) {
  const requests = []
  const client = { model: 'fixture', async complete(request) {
    requests.push(request)
    return { value: await fake(request), calls: 1, latency_ms: 0, usage: { input: 10, output: 5, cached: 0 },
      usage_by_call: [{ input: 10, output: 5, cache_hit: 0 }] }
  } }
  const rows = await routeSession(session, { client, mode: 'closed', ...options })
  return { requests, rows }
}
for (const variant of ['none', 'snapshot', 'compact', 'snapshot+compact']) {
  test(`product replay runs ${variant} through configuration, protocol and decision validation`, async () => {
    const { requests, rows } = await replay({ variant })
    assert.ok(rows.every(row => row.variant === variant && !row.error))
    assert.ok(rows.every(row => row.pred === session.threads[0].id))
    const wire = JSON.parse(requests[0].user)
    assert.equal(wire.protocol === 'snapshot-v1', variant.includes('snapshot'))
    assert.equal(requests[0].system.includes('compact-v1'), variant.includes('compact'))
    assert.equal(requests[0].maxTokens, 2048, 'output budget is unchanged')
  })
}
test('unspecified/none variant and absent salt preserve every request byte; salt covers routing, recheck and cards', async () => {
  const baseline = await replay({}), explicit = await replay({ variant: 'none', cacheSalt: undefined })
  const sent = requests => requests.map(({ system, user, maxTokens, override }) => ({ system, user, maxTokens, override }))
  assert.deepEqual(sent(explicit.requests), sent(baseline.requests))
  const salted = await replay({ variant: 'snapshot+compact', cacheSalt: 'isolated-run', mode: 'open', cards: true })
  assert.ok(salted.requests.length >= 3)
  assert.ok(salted.requests.every(r => r.system.startsWith('[cache-salt:"isolated-run"]\n')))
  assert.ok(salted.requests.some(r => r.maxTokens === 8192 && r.override?.thinking === null))
  assert.ok(salted.requests.some(r => r.tag.startsWith('card:')))
  assert.ok(salted.rows.every(r => !r.error && r.cache_salt === 'isolated-run'))
})
test('invalid variants and legacy variant combinations fail before invoking the model', async () => {
  await assert.rejects(() => replay({ variant: 'typo' }), /variant/)
  await assert.rejects(() => replay({ variant: 'compact', replay: 'legacy-v0' }), /product-v1/)
})
