// Corpus-only source probes; no predictions, model clients, cache, or credentials.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { continuesCurrent, settleUnclear } from '../../src/routing-policy.ts'
import { continuesCurrent as builtContinues, settleUnclear as builtSettle } from '../../dist/routing-policy.js'
import { bindingProposal } from './bindings.mjs'
const split = process.argv[2]
if (!['dev', 'test'].includes(split)) throw new Error('Usage: node --experimental-transform-types probe.mjs dev|test')
const here = new URL('./', import.meta.url)
if (split === 'test' && !existsSync(new URL('freeze.json', here))) throw new Error('Freeze dev rules before inspecting test')
const raw = readFileSync(new URL('../../eval/data/interleave-v0/sessions.jsonl', here))
const sessions = raw.toString('utf8').trim().split('\n').map(JSON.parse).filter(s => s.split === split)
const counts = { sessions: sessions.length, messages: 0, regex_hits: 0, current_available_after_first: 0,
  regex_hits_with_previous_turn: 0, shadow_binding_eligible: 0, short_chars_16: 0, implicit: 0,
  implicit_regex_hits: 0, source_dist_disagreements: 0 }
const metadata = Object.fromEntries(['reply', 'replyTo', 'reply_to', 'requestId', 'steering', 'attachments', 'goalId', 'events', 'timestamp'].map(k => [k, 0]))
const shortExamples = []
for (const s of sessions) for (let index = 0; index < s.turns.length; index++) {
  const t = s.turns[index]
  const fast = continuesCurrent(t.text)
  counts.messages++
  counts.regex_hits += fast
  counts.current_available_after_first += index > 0
  counts.regex_hits_with_previous_turn += fast && index > 0
  counts.source_dist_disagreements += fast !== builtContinues(t.text)
  counts.short_chars_16 += [...t.text.trim()].length <= 16
  counts.implicit += t.style === 'implicit'
  counts.implicit_regex_hits += t.style === 'implicit' && fast
  for (const key of Object.keys(metadata)) metadata[key] += Object.hasOwn(t, key)
  counts.shadow_binding_eligible += bindingProposal(t, { messages: [], pending: [] }, []) !== undefined
  if (shortExamples.length < 8 && [...t.text.trim()].length <= 16) shortExamples.push({ session: s.session_id, i: t.i, text: t.text, regex: fast })
}
assert.equal(counts.source_dist_disagreements, 0)
const contexts = ['a', 'b'].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' }))
const fixtures = [
  { decision: { action: 'CLARIFY', relatedIds: ['b', 'a'] }, current: 'a', want: 'a' },
  { decision: { action: 'CLARIFY', relatedIds: ['b'] }, current: 'a', want: 'b' },
  { decision: { action: 'CLARIFY', relatedIds: ['missing'] }, current: 'a', want: 'a' },
  { decision: { action: 'CLARIFY' }, contexts: [], want: 'CREATE' },
  { decision: { action: 'CLARIFY', reason: 'ROUTER_MODEL_MISSING' }, current: 'a', want: 'CLARIFY' },
]
for (const f of fixtures) {
  const result = settleUnclear(f.decision, 'example', f.contexts ?? contexts, f.current)
  assert.equal(result.contextId ?? result.action, f.want)
  assert.deepEqual(result, builtSettle(f.decision, 'example', f.contexts ?? contexts, f.current))
}
for (const text of ['继续', 'go on', 'thanks', '详细一点']) assert.equal(continuesCurrent(text), true)
const result = { split, corpus_sha256: createHash('sha256').update(raw).digest('hex'), counts, metadata, shortExamples,
  source_dist_settlement_fixtures: fixtures.length, positive_bare_continuation_fixtures: 4,
  note: 'Sequential product-v1 waits for idle and sends text only. Missing host metadata is not a trusted binding.' }
writeFileSync(new URL(`source-probe-${split}.json`, here), JSON.stringify(result, null, 2) + '\n', { flag: split === 'test' ? 'wx' : 'w' })
console.log(JSON.stringify(result))