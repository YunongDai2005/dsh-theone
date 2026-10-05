import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { accepts, evidenceEvents, FACT_LIMITS, rankCandidates, states, verify, type EvidenceEvent } from '../src/facts.ts'
import { applyExtraction, extractionPayload } from '../src/fact-flow.ts'
import { ContextStore } from '../src/store.ts'

const check = (events: EvidenceEvent[], value: string, quote: string, acceptsQuote?: string) =>
  verify({ sessionId: 's', events, kind: 'fact', value, quote, acceptsQuote })
const user = (text: string): EvidenceEvent[] => [{ seq: 1, speaker: 'user', text }]
const store = () => {
  const s = new ContextStore(':memory:')
  s.seed([{ id: 'a', title: 'a', summary: 'a', entities: [], keywords: [], lastState: '' }])
  return s
}
const write = (s: ContextStore, value: string, seq: number, expectedVersion?: number) => s.recordFact('a', {
  label: '预算', kind: 'fact', value, status: 'confirmed', origin: 'worker', expectedVersion,
  evidence: { sessionId: 's', seq, speaker: 'user', quote: `预算 ${value}` },
})

test('numeric evidence compares complete numbers, signs and units rather than substrings', () => {
  for (const [source, value] of [['预算 1800 元', '800'], ['预算 8000', '800'], ['预算 -800', '800'],
    ['日期 3 月 20 日', '3 月 2 日'], ['日期 20 月 3 日', '3 月 20 日'], ['预算 800 元', '800 万'], ['负责人 P1', 'D1']]) {
    assert.equal(states(source, value), false, `${source} must not confirm ${value}`)
  }
  assert.ok(states('预算 1,800 元', '1800') && states('Budget is $1,200', '1200'))
  assert.ok(states('日期 3 月 20 日', '3月20日'))
})

test('full user context prevents refusals, questions and clipped acceptances from confirming facts', () => {
  for (const text of ['不要用 800 元作为预算', '预算不是 800 元', '预算 800 元可以吗？', 'Budget might be 800', '预算暂定 800']) {
    assert.equal(check(user(text), '800', '800').status, 'proposed', text)
  }
  assert.equal(check(user('预算不是 800，改成 700 元。'), '700', '改成 700 元').status, 'confirmed')
  assert.equal(check(user('预算不要用 800，茶点费用是 800。'), '800', '预算不要用 800').status, 'proposed')
  const events: EvidenceEvent[] = [
    { seq: 1, speaker: 'assistant', text: '建议预算 800 元' },
    { seq: 2, speaker: 'user', text: '好的，但不要用这个预算' },
  ]
  assert.equal(check(events, '800', '好的', '建议预算 800 元').status, 'proposed')
  events.push({ seq: 3, speaker: 'assistant', text: '建议场地选社区活动室' }, { seq: 4, speaker: 'user', text: '好，就按你说的来' })
  assert.equal(check(events, '800', '好，就按你说的来', '建议预算 800 元').status, 'proposed', 'an acceptance does not approve an unrelated earlier proposal')
  assert.equal(accepts('旅行照常进行'), false)
  assert.equal(accepts('明天去好莱坞'), false)
})

test('only a successful tool result can confirm an artifact, never a request or error', () => {
  const call = { type: 'tool/call', seq: 1, data: { name: 'write_file', callId: 'c', arguments: '{"path":"plan/budget.md"}' } }
  const result = (isError: boolean) => ({ type: 'tool/result', seq: 2, data: { message: {
    source: { callId: 'c' }, isError, content: [{ type: 'text', text: isError ? 'permission denied: plan/budget.md' : 'created plan/budget.md' }],
  } } })
  const verdict = (events: unknown[]) => verify({ sessionId: 's', events: evidenceEvents(events as SessionEvent[]),
    kind: 'artifact', value: 'plan/budget.md', quote: 'plan/budget.md' }).status
  assert.equal(verdict([call]), 'proposed')
  assert.equal(verdict([call, result(true)]), 'proposed')
  assert.equal(verdict([call, result(false)]), 'confirmed')
  assert.equal(verdict([{ ...call, data: { ...call.data, name: 'theone_record' } }, result(false)]), 'proposed')
})

test('reaffirming a value advances its evidence and blocks an older extraction', () => {
  const s = store()
  try {
    write(s, '800', 10)
    write(s, '800', 30)
    assert.equal(s.facts('a')[0].evidence.seq, 30)
    assert.equal(write(s, '700', 20, 1).outcome, 'rejected')
    assert.equal(write(s, '700', 20).reason, 'older-evidence')
    assert.equal(s.facts('a')[0].value, '800')
    assert.equal(write(s, '800', 30).outcome, 'unchanged')
  } finally { s.close() }
})

test('an alternate label written by identity is retained as an alias instead of creating a duplicate later', () => {
  const s = store()
  try {
    const fact = write(s, '800', 10).fact!
    const update = (seq: number, factId?: string) => s.recordFact('a', { factId, label: 'Budget', kind: 'fact', value: '800',
      status: 'confirmed', origin: 'worker', evidence: { sessionId: 's', seq, speaker: 'user', quote: 'Budget 800' } })
    update(20, fact.id)
    assert.ok(s.fact(fact.id)?.aliases.includes('budget'))
    assert.equal(update(30).fact?.id, fact.id)
    assert.equal(s.facts('a').length, 1)
  } finally { s.close() }
})

test('extraction can restore a retracted identity while still rejecting genuinely stale writes', () => {
  const s = store()
  try {
    const fact = write(s, '800', 10).fact!
    s.retractFact('a', fact.id, { sessionId: 's', seq: 20, speaker: 'user', quote: '预算未定' }, 'worker')
    const base = s.facts('a', true)
    assert.equal(base[0].status, 'retracted')
    assert.equal(s.sharedFacts().length, 0)
    assert.equal(applyExtraction(s, { sessionId: 's', contextId: 'a', base,
      events: [{ seq: 30, speaker: 'user', text: '预算重新定为 900 元' }],
      items: [{ label: '预算', kind: 'fact', value: '900', evidenceQuote: '预算重新定为 900 元' }] }), 1)
    assert.deepEqual([s.fact(fact.id)?.status, s.fact(fact.id)?.value], ['confirmed', '900'])
    assert.equal(applyExtraction(s, { sessionId: 's', contextId: 'a', base,
      events: [{ seq: 25, speaker: 'user', text: '预算 700 元' }],
      items: [{ factId: fact.id, value: '700', evidenceQuote: '预算 700 元' }] }), 0)
  } finally { s.close() }
})

test('a quoted confirmation cannot be misused to retract the fact', () => {
  const s = store()
  try {
    const fact = write(s, '800', 10).fact!
    assert.equal(applyExtraction(s, { sessionId: 's', contextId: 'a', base: s.facts('a', true),
      events: [{ seq: 20, speaker: 'user', text: '预算仍然是 800' }],
      items: [{ op: 'retract', factId: fact.id, evidenceQuote: '预算仍然是 800' }] }), 0)
    assert.equal(s.fact(fact.id)?.status, 'confirmed')
  } finally { s.close() }
})

test('serialized extraction and candidate payloads respect their hard budgets even with escaping', () => {
  const events: EvidenceEvent[] = [
    { seq: 1, speaker: 'user', text: '\\"\n'.repeat(3000) },
    { seq: 2, speaker: 'assistant', text: '\\"\n'.repeat(3000) },
  ]
  assert.ok(JSON.stringify(extractionPayload(events, [])).length <= FACT_LIMITS.extractionBudget)
  const s = store()
  try {
    for (let n = 0; n < 20; n++) s.recordFact('a', { label: `预算${n}`, kind: 'fact', value: '800', status: 'confirmed', origin: 'worker',
      evidence: { sessionId: 's', seq: n, speaker: 'user', quote: '预算 800' } })
    const candidates = rankCandidates(s.facts('a').map(fact => ({ ...fact, topicTitle: '预算', related: 0 })), '预算')
    assert.ok(candidates.length > 0)
    assert.ok(JSON.stringify(candidates).length <= FACT_LIMITS.routerBudget)
  } finally { s.close() }
})
