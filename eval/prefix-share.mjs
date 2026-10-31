#!/usr/bin/env node
// Offline upper bound for prefix caching; gold labels route messages, never a model.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { routingPrompt, routingPayload } from '../dist/llm-router.js'
import { topicTerms } from '../dist/routing-policy.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Approximation only: a Han character costs 1/1.5 tokens, other characters 1/4. */
export function estimateTokens(text) {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).join('').length
  return han / 1.5 + (text.length - han) / 4
}

export function commonPrefix(first, second) {
  let length = 0
  while (length < first.length && length < second.length && first[length] === second[length]) length++
  return length
}

/** Call separately for each session: a different session's requests cannot warm this cache. */
export function measureRequests(requests) {
  const result = { requests: requests.length, characters: 0, tokens: 0, shared_characters: 0, cacheable_tokens: 0 }
  requests.forEach((request, index) => {
    let shared = 0
    for (let before = 0; before < index; before++) shared = Math.max(shared, commonPrefix(requests[before], request))
    result.characters += request.length
    result.tokens += estimateTokens(request)
    result.shared_characters += shared
    result.cacheable_tokens += Math.floor(estimateTokens(request.slice(0, shared)) / 64) * 64
  })
  return result
}

/** Same descriptors as run-router's describe/apply, using gold thread ids instead of model answers. */
export function replayRequests(session, { mode = 'open' } = {}) {
  const topics = mode === 'closed'
    ? session.threads.map(thread => ({ id: thread.id, title: thread.title, summary: thread.description, entities: [], keywords: [], lastState: '', texts: [] }))
    : []
  const recent = []
  let currentId
  return session.turns.map(turn => {
    const contexts = topics.map(topic => ({ id: topic.id, title: topic.title, summary: topic.summary, entities: topic.entities,
      keywords: [...new Set([...topic.keywords, ...[...new Set(topic.texts.flatMap(text => topicTerms(text)))].slice(-24)])].slice(0, 24),
      lastState: topic.texts.at(-1)?.slice(0, 400) ?? topic.lastState }))
    const payload = routingPayload({ text: turn.text, contexts, catalogOrder: topics.map(topic => topic.id), currentId, recent: recent.slice(-12) })
    const system = routingPrompt(payload)
    const row = { i: turn.i, payload, system, request: system + JSON.stringify(payload) }
    // One-off questions get isolated topics, just as a gold CREATE would; they never join a thread.
    const id = turn.gold.thread ?? `oneoff:${turn.i}`
    let topic = topics.find(topic => topic.id === id)
    if (!topic) {
      topic = { id, title: turn.text.slice(0, 30), summary: turn.text.slice(0, 200), entities: [], keywords: [], lastState: '', texts: [] }
      topics.push(topic)
    }
    topic.texts.push(turn.text)
    currentId = id
    recent.push({ role: 'user', text: turn.text })
    return row
  })
}

function summarize(totals) {
  return { ...totals,
    average_characters: totals.requests ? totals.characters / totals.requests : 0,
    average_tokens: totals.requests ? totals.tokens / totals.requests : 0,
    cacheable_token_share: totals.tokens ? totals.cacheable_tokens / totals.tokens : 0,
    shared_character_share: totals.characters ? totals.shared_characters / totals.characters : 0 }
}

export function evaluatePrefixes(sessions, { mode = 'open', split = 'dev' } = {}) {
  const totals = new Map()
  const examples = []
  for (const session of sessions.filter(session => session.split === split)) {
    const rows = replayRequests(session, { mode })
    const measured = measureRequests(rows.map(row => row.request))
    for (const lang of [session.lang, 'total']) {
      const sum = totals.get(lang) ?? Object.fromEntries(Object.keys(measured).map(key => [key, 0]))
      for (const key of Object.keys(measured)) sum[key] += measured[key]
      totals.set(lang, sum)
    }
    if (!examples.some(row => row.lang === session.lang) && rows.length) {
      const row = rows[Math.min(12, rows.length - 1)]
      examples.push({ lang: session.lang, session_id: session.session_id, i: row.i, characters: row.request.length,
        tokens: estimateTokens(row.request), system_characters: row.system.length, system_tokens: estimateTokens(row.system) })
    }
  }
  return { mode, split, approximation: 'Han chars / 1.5 + other chars / 4; reusable prefix rounded down to 64 tokens',
    rows: [...totals].sort(([a], [b]) => (a === 'total') - (b === 'total') || a.localeCompare(b)).map(([lang, sum]) => ({ lang, ...summarize(sum) })), examples }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    data: { type: 'string', default: join(here, 'data', 'interleave-v0', 'sessions.jsonl') },
    split: { type: 'string', default: 'dev' }, mode: { type: 'string', default: 'open' }, json: { type: 'boolean', default: false } } })
  if (!['dev', 'test'].includes(values.split) || !['closed', 'open'].includes(values.mode)) throw new Error('--split dev|test, --mode closed|open')
  const sessions = readFileSync(values.data, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
  const result = evaluatePrefixes(sessions, values)
  if (values.json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`Prefix-cache upper bound (${values.split}, ${values.mode}); approximate tokens, 64-token blocks`)
    console.log('| lang | requests | avg chars | avg tokens | cacheable tokens | shared chars |')
    console.log('|---|---:|---:|---:|---:|---:|')
    for (const row of result.rows) console.log(`| ${row.lang} | ${row.requests} | ${row.average_characters.toFixed(1)} | ${row.average_tokens.toFixed(1)} | ${(100 * row.cacheable_token_share).toFixed(2)}% | ${(100 * row.shared_character_share).toFixed(2)}% |`)
  }
}