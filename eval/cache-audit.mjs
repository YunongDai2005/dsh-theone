#!/usr/bin/env node
// Product replay with a strictly local fake transport. Never loads model credentials or a host profile.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { routeSession, readSessions } from './run-router.mjs'
import fake from './test/fake-model.mjs'
import { estimateTokens, measureRequests } from './prefix-share.mjs'
import { ROUTING_VARIANTS, routingVariant } from '../dist/routing-experiments.js'

export function firstDivergence(before, after) {
  if (before.system !== after.system) return 'system'
  const a = JSON.parse(before.user), b = JSON.parse(after.user)
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue
    if (key !== 'contexts') return key
    if (JSON.stringify(a.contexts?.map(c => c.id)) !== JSON.stringify(b.contexts?.map(c => c.id))) return 'contexts.members'
    const at = b.contexts.findIndex((c, i) => JSON.stringify(c) !== JSON.stringify(a.contexts[i]))
    return 'contexts.' + [...new Set([...Object.keys(a.contexts[at]), ...Object.keys(b.contexts[at])])]
      .find(k => JSON.stringify(a.contexts[at][k]) !== JSON.stringify(b.contexts[at][k]))
  }
  return 'identical'
}

export function summarizeGroups(groups) {
  const totals = new Map()
  for (const group of groups) {
    const key = [group.variant, group.split, group.mode].join('/')
    const sum = totals.get(key) ?? { variant: group.variant, split: group.split, mode: group.mode, messages: 0,
      requests: 0, characters: 0, tokens: 0, shared_characters: 0, cacheable_tokens: 0, forks: {} }
    for (const name of ['messages', 'requests', 'characters', 'tokens', 'shared_characters', 'cacheable_tokens']) sum[name] += group[name]
    for (const [field, n] of Object.entries(group.forks)) sum.forks[field] = (sum.forks[field] ?? 0) + n
    totals.set(key, sum)
  }
  return [...totals.values()].map(row => ({ ...row, average_characters: row.characters / (row.requests || 1),
    average_tokens: row.tokens / (row.requests || 1), cacheable_token_share: row.tokens ? row.cacheable_tokens / row.tokens : 0,
    miss_tokens: row.tokens - row.cacheable_tokens, average_miss_tokens: (row.tokens - row.cacheable_tokens) / (row.requests || 1),
    miss_tokens_per_message: (row.tokens - row.cacheable_tokens) / (row.messages || 1) }))
}

export async function auditSession(session, { mode, variant }) {
  const requests = [], raw = [], ids = new Map()
  // Only random identities are normalized, preserving every other character and generation parameter.
  const normalize = text => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, id => {
    if (!ids.has(id)) ids.set(id, `uuid-${String(ids.size).padStart(5, '0')}`)
    return ids.get(id)
  })
  const client = { model: 'fixture', async complete(request) {
    const { system, user, maxTokens, override, tag } = request
    const row = { session_id: session.session_id, split: session.split, mode, system, user, maxTokens, ...(override ? { override } : {}), tag }
    requests.push(JSON.parse(normalize(JSON.stringify(row))))
    if (tag.startsWith('route:')) raw.push(row)
    const value = await fake(request)
    const input = Math.ceil(estimateTokens(system + user)), output = Math.ceil(estimateTokens(value))
    return { value, calls: 1, latency_ms: 0, usage: { input, output, cached: 0 },
      usage_by_call: [{ input, output, cache_hit: 0 }] }
  } }
  const predictions = await routeSession(session, { mode, cards: true, client, variant })
  // Preserve the same identity traversal as the pre-change capture.
  for (const row of predictions) normalize(JSON.stringify(row))
  const forks = {}
  for (let i = 1; i < raw.length; i++) {
    const field = firstDivergence(raw[i - 1], raw[i])
    forks[field] = (forks[field] ?? 0) + 1
  }
  return { requests, predictions: predictions.map(row => ({ ...row, fake_model: true })),
    group: { mode, variant, split: session.split, messages: session.turns.length, forks, ...measureRequests(raw.map(r => r.system + r.user)) } }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    data: { type: 'string', default: 'eval/data/interleave-v0/sessions.jsonl' }, out: { type: 'string', default: 'eval/.cache/cache-audit' },
    variant: { type: 'string', default: 'all' }, split: { type: 'string', default: 'all' }, mode: { type: 'string', default: 'all' },
    baseline: { type: 'string' } } })
  const variants = values.variant === 'all' ? ROUTING_VARIANTS : [routingVariant(values.variant)]
  if (!['all', 'dev', 'test'].includes(values.split) || !['all', 'open', 'closed'].includes(values.mode)) throw new Error('Invalid split/mode')
  const sessions = readSessions(values.data).filter(s => values.split === 'all' || s.split === values.split)
  const groups = [], requests = [], predictions = []
  for (const variant of variants) for (const mode of values.mode === 'all' ? ['open', 'closed'] : [values.mode]) {
    for (let offset = 0; offset < sessions.length; offset += 4) {
      const batch = await Promise.all(sessions.slice(offset, offset + 4).map(session => auditSession(session, { mode, variant })))
      for (const result of batch) { groups.push(result.group); requests.push(...result.requests); predictions.push(...result.predictions) }
      console.error(`${variant}/${mode}: ${Math.min(offset + 4, sessions.length)}/${sessions.length} sessions`)
    }
  }
  mkdirSync(values.out, { recursive: true })
  const summary = { approximation: 'Product fake replay; cards enabled. Best prior same-session prefix, Han / 1.5 + other / 4, rounded down to 64-token blocks; no provider cache simulation.',
    rows: summarizeGroups(groups), predictions: predictions.length, errors: predictions.filter(row => row.error).length }
  if (values.baseline) {
    if (variants.length !== 1 || variants[0] !== 'none') throw new Error('--baseline requires --variant none')
    const before = JSON.parse(readFileSync(values.baseline, 'utf8'))
    let differences = Math.abs(before.length - requests.length)
    for (let i = 0; i < Math.min(before.length, requests.length); i++) if (JSON.stringify(before[i]) !== JSON.stringify(requests[i])) differences++
    summary.baseline = { requests_before: before.length, requests_after: requests.length, differences }
  }
  writeFileSync(join(values.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  writeFileSync(join(values.out, 'requests.json'), JSON.stringify(requests) + '\n')
  for (const variant of variants) for (const mode of ['open', 'closed']) for (const split of ['dev', 'test']) {
    const ids = new Set(sessions.filter(s => s.split === split).map(s => s.session_id))
    const selected = predictions.filter(r => r.variant === variant && r.mode === mode && ids.has(r.session_id))
    if (selected.length) writeFileSync(join(values.out, `${variant}-${mode}-${split}.jsonl`), selected.map(r => JSON.stringify(r)).join('\n') + '\n')
  }
  console.log(JSON.stringify(summary, null, 2))
  if (summary.errors || summary.baseline?.differences) process.exitCode = 1
}
