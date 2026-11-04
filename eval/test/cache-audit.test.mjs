import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as audit from '../cache-audit.mjs'
test('first divergence distinguishes template churn, candidate membership, card edits and sliding recent', () => {
  assert.equal(typeof audit.firstDivergence, 'function')
  const before = { system: 'same', user: JSON.stringify({ contexts: [{ id: 'a', summary: 'old' }], recent: [{ role: 'user', text: 'first' }] }) }
  const row = payload => ({ system: 'same', user: JSON.stringify(payload) })
  assert.equal(audit.firstDivergence(before, { ...before, system: 'changed' }), 'system')
  assert.equal(audit.firstDivergence(before, row({ contexts: [], recent: [] })), 'contexts.members')
  assert.equal(audit.firstDivergence(before, row({ contexts: [{ id: 'a', summary: 'new' }], recent: [] })), 'contexts.summary')
  assert.equal(audit.firstDivergence(before, row({ contexts: [{ id: 'a', summary: 'old' }], recent: [] })), 'recent')
  assert.equal(audit.firstDivergence(before, before), 'identical')
})
test('offline totals include cold misses and absolute missed input as well as share', () => {
  assert.equal(typeof audit.summarizeGroups, 'function')
  const [row] = audit.summarizeGroups([{ split: 'dev', mode: 'open', variant: 'none', messages: 3, requests: 2,
    characters: 1200, tokens: 300, shared_characters: 600, cacheable_tokens: 128, forks: { recent: 1 } }])
  assert.equal(row.average_tokens, 150)
  assert.equal(row.miss_tokens, 172)
  assert.equal(row.average_miss_tokens, 86)
  assert.equal(row.miss_tokens_per_message, 172 / 3)
  assert.equal(row.cacheable_token_share, 128 / 300)
})
