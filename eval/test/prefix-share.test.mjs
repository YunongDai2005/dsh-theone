import { test } from 'node:test'
import assert from 'node:assert/strict'

const prefix = await import('../prefix-share.mjs')

test('prefix measurement uses the best earlier request in the same session, with 64-token blocks', () => {
  assert.equal(typeof prefix.measureRequests, 'function')
  const result = prefix.measureRequests(['x'.repeat(300), 'y'.repeat(300), 'x'.repeat(299) + 'z'])
  assert.equal(result.requests, 3)
  assert.equal(result.characters, 900)
  assert.equal(result.tokens, 225)
  assert.equal(result.shared_characters, 299)
  assert.equal(result.cacheable_tokens, 64)
  assert.equal(prefix.estimateTokens('中文中文中文abcd'), 5)
})

test('gold replay builds topics after their first message and keeps the real descriptor and recent window', () => {
  assert.equal(typeof prefix.replayRequests, 'function')
  const session = { session_id: 's', lang: 'en', threads: [{ id: 'a', title: 'Catalog A', description: 'known' }],
    turns: Array.from({ length: 15 }, (_, i) => ({ i, text: i ? `alpha message ${i}` : 'first alpha request', gold: { thread: 'a' } })) }
  const open = prefix.replayRequests(session, { mode: 'open' })
  assert.deepEqual(open[0].payload.contexts, [])
  assert.equal(open[1].payload.contexts[0].title, 'first alpha request')
  assert.equal(open[1].payload.contexts[0].summary, 'first alpha request')
  const last = open[14].payload
  const state = last.states?.[0] ?? last.contexts[0]
  assert.equal(state.lastState, 'alpha message 13')
  assert.equal(last.recent.length, 12)
  assert.equal(last.recent[0].text, 'alpha message 2')
  const closed = prefix.replayRequests(session, { mode: 'closed' })
  assert.equal(closed[0].payload.contexts[0].title, 'Catalog A')
  assert.equal(closed[0].payload.contexts[0].summary, 'known')
  assert.equal(closed[0].request, closed[0].system + JSON.stringify(closed[0].payload))
})

test('split and language totals never reuse a different session first request', () => {
  const session = (session_id, lang, split) => ({ session_id, lang, split, threads: [], turns: [{ i: 0, text: 'a new task', gold: { thread: 'a' } }] })
  const measured = prefix.evaluatePrefixes([session('one', 'en', 'dev'), session('two', 'zh', 'dev'), session('three', 'en', 'test')])
  assert.deepEqual(measured.rows.map(row => [row.lang, row.requests, row.cacheable_tokens, row.shared_characters]),
    [['en', 1, 0, 0], ['zh', 1, 0, 0], ['total', 2, 0, 0]])
})
