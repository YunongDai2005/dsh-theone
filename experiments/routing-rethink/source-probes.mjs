// Run: node --experimental-transform-types experiments/routing-rethink/source-probes.mjs
// Local source functions only. Never starts catalog scans or a router/model client.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { continuesCurrent, settleUnclear, topicTerms } from '../../src/routing-policy.ts'
import { routingEvidence } from '../../src/routing-evidence.ts'
import { resolveContext } from '../../src/router.ts'
import { HistoryCatalog } from '../../src/history-catalog.ts'
import { routingPrompt, routingPayload } from '../../src/llm-router.ts'
import { replayRequests, measureRequests, estimateTokens } from '../../eval/prefix-share.mjs'

globalThis.fetch = () => { throw new Error('Network disabled in routing-rethink experiments') }
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = join(here, 'results')
mkdirSync(out, { recursive: true })
const read = name => readFileSync(join(root, name), 'utf8').replace(/^\uFEFF/, '')
const sessions = read('eval/data/interleave-v0/sessions.jsonl').trim().split('\n').map(JSON.parse)
const mid = JSON.parse(read('eval/data/mid-reply/cases.json'))
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n')
const tally = (bag, key, hit) => { const v = bag[key] ??= { n: 0, correct: 0 }; v.n++; v.correct += Number(hit) }
const descriptor = (t, id = t.id) => ({ id, title: t.title, summary: t.description, entities: [], keywords: [], lastState: '', workingSessionId: id })
const sourceResults = { fastPath: {}, evidence: {}, candidates: {}, midReply: {}, payloadParity: 0 }
const evidenceRows = [], candidateMisses = []

for (const s of sessions) {
  const topics = s.threads.map(t => ({ ...descriptor(t), texts: [] }))
  let current
  const seen = new Set()
  const extraPool = sessions.filter(o => o.split === 'dev' && o.lang === s.lang && o.session_id !== s.session_id)
    .flatMap(o => o.threads.map(t => descriptor(t, `${o.session_id}/${t.id}`)))
  assert(extraPool.length >= 64)
  for (const t of s.turns) {
    const fast = !!current && continuesCurrent(t.text)
    tally(sourceResults.fastPath, s.split, fast)
    const clues = routingEvidence(t.text, topics.map(p => ({ id: p.id, texts: [p.title, p.summary, ...p.texts] })))
    if (!t.ambiguous && clues.length === 1) {
      const correct = clues[0].contextId === t.gold.thread
      tally(sourceResults.evidence, s.split, correct)
      tally(sourceResults.evidence, `${s.split}/${s.lang}`, correct)
      tally(sourceResults.evidence, `${s.split}/${t.gold.thread === null ? 'oneoff' : 'thread'}`, correct)
      evidenceRows.push({ split: s.split, session: s.session_id, i: t.i, text: t.text, gold: t.gold.thread, clue: clues[0], correct })
    }
    // Known-catalog, gold-history diagnostic. Current topic is oracle previous route.
    // Distractors are frozen dev catalog descriptors, never messages or test labels.
    if (!t.ambiguous && t.gold.thread !== null && seen.has(t.gold.thread)) {
      for (const extras of [0, 16, 64]) {
        const contexts = [...topics.map(p => ({ ...p, keywords: [...new Set(p.texts.flatMap(x => topicTerms(x)))].slice(-24), lastState: p.texts.at(-1)?.slice(0, 400) ?? '' })), ...extraPool.slice(0, extras)]
        const store = { unreachable: () => new Set(), contexts: () => contexts, contextsForSessions: () => [] }
        const ctx = { sessionQuery: { searchSessions: async () => ({ items: [] }) } }
        const catalog = new HistoryCatalog(ctx, store, () => { throw new Error('Model selection forbidden') })
        const found = await catalog.candidates(t.text, current, undefined, { contexts })
        const hit = found.some(p => p.id === t.gold.thread)
        tally(sourceResults.candidates, `${s.split}/extra${extras}`, hit)
        tally(sourceResults.candidates, `${s.split}/extra${extras}/${current === t.gold.thread ? 'same' : 'switch'}`, hit)
        if (t.tags.includes('twin')) tally(sourceResults.candidates, `${s.split}/extra${extras}/twin`, hit)
        if (!hit && extras === 64) candidateMisses.push({ split:s.split, session:s.session_id, i:t.i, text:t.text, gold:t.gold.thread, current, offered:found.map(p=>p.id) })
      }
    }
    const id = t.gold.thread ?? `oneoff:${t.i}`
    let topic = topics.find(p => p.id === id)
    if (!topic) { topic = { id, title: t.text.slice(0,30), summary:t.text.slice(0,200), entities:[], keywords:[], lastState:'', texts:[], workingSessionId:id }; topics.push(topic) }
    topic.texts.push(t.text)
    current = id
    if (t.gold.thread !== null) seen.add(t.gold.thread)
  }
}

const midRows = mid.cases.map(c => {
  const target = c.expect === 'running' ? c.running.topicId : c.expect
  const rule = resolveContext(c.text, mid.catalogs[c.lang], c.running.topicId)
  const predicted = rule.action === 'CREATE' ? 'new' : rule.contextId ?? rule.action
  tally(sourceResults.midReply, 'blind_running', target === c.running.topicId)
  tally(sourceResults.midReply, 'rule_only', predicted === target)
  tally(sourceResults.midReply, `rule_only/${c.expect === 'running' ? 'running' : c.expect === 'new' ? 'new' : 'other'}`, predicted === target)
  return { id:c.id, text:c.text, target, blind_running:c.running.topicId, rule:predicted, correct:predicted===target }
})

const contexts = ['a','b'].map(id => ({ id, title:id, summary:'', entities:[], keywords:[], lastState:'' }))
const settlement = [
  { name:'ambiguous_two_topics', before:{action:'CLARIFY',reason:'ambiguous',question:'a or b?',relatedIds:['a','b']} },
  { name:'missing_history_no_candidates', before:{action:'CLARIFY',reason:'missing-history',question:'which previous task?'} },
].map(c => ({ ...c, after:settleUnclear(c.before, '继续上次那个', contexts, 'a') }))
assert(settlement.every(c => c.after.contextId === 'a'))

const sums = new Map()
const add = (key, measure) => {
  const sum = sums.get(key) ?? { requests:0, characters:0, tokens:0, shared_characters:0, cacheable_tokens:0 }
  for (const field of Object.keys(sum)) sum[field] += measure[field]
  sums.set(key, sum)
}
for (const s of sessions) for (const mode of ['open', 'closed']) {
  const rows = replayRequests(s, { mode })
  const variant = []
  for (const r of rows) {
    // For these bounded benchmark inputs, rehydrate source descriptors and compare dist output.
    const contexts = r.payload.contexts.map(c => ({...c, lastState:'', ...r.payload.states?.find(v=>v.id===c.id)}))
    const source = routingPayload({...r.payload, contexts, currentId:r.payload.currentId ?? undefined})
    assert.deepEqual(source, r.payload)
    assert.equal(routingPrompt(source), r.system)
    sourceResults.payloadParity++
    // Counterfactual serialization only: move keywords to dynamic states, preserve every value.
    const p = structuredClone(r.payload)
    const states = p.contexts.map(c => ({...p.states?.find(v=>v.id===c.id), id:c.id, keywords:c.keywords}))
    p.contexts = p.contexts.map(({keywords, ...c}) => c)
    p.states = states
    variant.push(r.system + JSON.stringify(p))
  }
  for (const lang of [s.lang, 'total']) {
    add(`${s.split}/${mode}/${lang}/current`, measureRequests(rows.map(r=>r.request)))
    add(`${s.split}/${mode}/${lang}/keywords_dynamic`, measureRequests(variant))
  }
}
const prefixes = Object.fromEntries([...sums].map(([key, s]) => [key, {...s, average_tokens:s.tokens/s.requests,
  reusable_share:s.cacheable_tokens/s.tokens, estimated_miss_tokens:(s.tokens-s.cacheable_tokens)/s.requests}]))
const files = ['src/llm-router.ts','src/router.ts','src/routing-policy.ts','src/routing-evidence.ts','src/history-catalog.ts','src/index.ts','src/topic-memory.ts','eval/run-router.mjs','eval/score.py','eval/baselines.py','eval/prefix-share.mjs','eval/data/interleave-v0/sessions.jsonl','eval/data/mid-reply/cases.json','dist/llm-router.js','dist/routing-policy.js']
save('source-probes.json', { description:'Local functions; candidate FTS returns no hits, prior empty, gold previous state; prefix tokens estimated, not provider cache.', ...sourceResults, settlement, prefixes,
  system:{characters:routingPrompt({}).length, estimated_tokens:estimateTokens(routingPrompt({}))},
  hashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(root,file))).digest('hex')])) })
save('evidence-decisions.json', evidenceRows)
save('candidate-misses.json', candidateMisses)
save('mid-reply-decisions.json', midRows)
console.log(JSON.stringify({ ...sourceResults, prefixes:Object.fromEntries(Object.entries(prefixes).filter(([key])=>key.includes('/total/'))) }, null, 2))
