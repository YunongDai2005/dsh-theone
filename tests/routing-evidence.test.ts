import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVIDENCE_PROMPT, evidenceConflict, evidenceTerms, routingEvidence, secondLook } from '../src/routing-evidence.ts'
import { routingPayload, routingPrompt } from '../src/llm-router.ts'

const topics = [
  { id: 'budget', texts: ['家庭月度记账', '这个月目标是把开销控制在1500以内', '外卖花太多了'] },
  { id: 'trip', texts: ['国庆厦门亲子游', '预算8000，住鼓浪屿附近', '外卖也算进预算吗'] },
  { id: 'claim', texts: ['处理交通事故理赔', '理赔单号 P-2023-1012 已经提交'] },
]

test('a number, code or name only one topic has mentioned is evidence for it; shared details and ordinary words are not', () => {
  assert.deepEqual(routingEvidence('那个1500的目标，你觉得实际能做到吗', topics), [{ contextId: 'budget', terms: ['1500'], strong: true }])
  // "外卖" appears in two topics, and "鼓浪屿" is an ordinary word here: neither points anywhere.
  assert.deepEqual(routingEvidence('外卖怎么办', topics), [])
  assert.deepEqual(routingEvidence('鼓浪屿那边怎么样', topics), [])
  assert.deepEqual(routingEvidence('P-2023-1012交上去之后，我回头去弄那个销售报告', topics)[0], { contextId: 'claim', terms: ['p-2023-1012'], strong: true })
  // Thousands separators and case do not hide a match.
  assert.equal(routingEvidence('Is 8,000 enough?', topics)[0].contextId, 'trip')
  assert.deepEqual(routingEvidence('anything', [topics[0]]), [], 'one topic needs no evidence')
})

test('numbers, codes and names inside a sentence are strong; ordinary words are not', () => {
  const terms = Object.fromEntries(evidenceTerms('Mr. Johnson still owes the $1,200 deposit, see PR-42 and the lease').map(item => [item.term, item.strong]))
  assert.equal(terms.johnson, true)
  assert.equal(terms['1200'], true)
  assert.equal(terms['pr-42'], true)
  assert.equal(terms.lease, false)
  assert.equal(terms.still, undefined, 'common words are skipped')
  assert.equal(Object.fromEntries(evidenceTerms('Lease terms look fine').map(item => [item.term, item.strong])).lease, false, 'a capital at the start is not a name')
})

test('a decision against the one topic holding strong evidence is a conflict; agreeing or split evidence is not', () => {
  const evidence = routingEvidence('那个1500的目标，你觉得实际能做到吗', topics)
  assert.equal(evidenceConflict({ action: 'SWAP', contextId: 'trip', reason: 'x' }, evidence), 'budget')
  assert.equal(evidenceConflict({ action: 'CREATE', title: 'x', reason: 'x' }, evidence), 'budget')
  assert.equal(evidenceConflict({ action: 'KEEP', contextId: 'budget', reason: 'x' }, evidence), undefined)
  assert.equal(evidenceConflict({ action: 'KEEP', contextId: 'trip', reason: 'x' }, [...evidence, { contextId: 'claim', terms: ['p-1'], strong: true }]), undefined)
  assert.equal(evidenceConflict({ action: 'KEEP', contextId: 'trip', reason: 'x' }, [{ contextId: 'budget', terms: ['目标'], strong: false }]), undefined)
})

test('a new topic, a question, or a decision against a strong clue gets a second look; an agreeing pick does not', () => {
  const evidence = routingEvidence('那个1500的目标，你觉得实际能做到吗', topics)
  assert.deepEqual(secondLook({ action: 'SWAP', contextId: 'trip', reason: 'x' }, evidence), { previous: 'trip', contextId: 'budget', terms: ['1500'] })
  assert.deepEqual(secondLook({ action: 'CREATE', title: 'x', reason: 'x' }, []), { previous: 'CREATE' })
  assert.deepEqual(secondLook({ action: 'CLARIFY', question: '哪个？', reason: 'x' }, []), { previous: 'CLARIFY' })
  assert.equal(secondLook({ action: 'KEEP', contextId: 'budget', reason: 'x' }, evidence), undefined)
  assert.equal(secondLook({ action: 'SWAP', contextId: 'trip', reason: 'x' }, []), undefined)
})

test('evidence reaches the classifier only for offered topics, with its instructions', () => {
  const contexts = topics.map(topic => ({ id: topic.id, title: topic.texts[0], summary: '', entities: [], keywords: [], lastState: '' }))
  const payload = routingPayload({ text: '1500 够吗', contexts: contexts.slice(0, 2), evidence: [{ contextId: 'budget', terms: ['1500'], strong: true }, { contextId: 'claim', terms: ['x'], strong: true }] })
  assert.deepEqual((payload as { evidence?: unknown }).evidence, [{ contextId: 'budget', terms: ['1500'], strong: true }])
  assert.ok(routingPrompt(payload).endsWith(EVIDENCE_PROMPT))
  assert.ok(!routingPrompt(routingPayload({ text: '1500 够吗', contexts })).includes('evidence'))
})

test('a decision against a strong clue is asked once more with thinking on, and the second answer is used', { timeout: 60000 }, async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { harness, ask, FixtureModel, textResponse } = await import('./harness.ts')
  const { ROUTING_PROMPT } = await import('../src/llm-router.ts')
  const root = await mkdtemp(join(tmpdir(), 'theone-evidence-'))
  const model = new FixtureModel()
  const routed: { payload: { evidence?: unknown; recheck?: unknown }; maxTokens?: number }[] = []
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text)
      routed.push({ payload, maxTokens: options.maxTokens })
      // The first message goes to the thesis (against the clue) until asked again; later ones go where the clue points.
      const contextId = payload.recheck || routed.length > 2 ? 'ctx_qwen_9070xt' : 'ctx_thesis'
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId, title: null, question: null, reason: 'test', historyIndependent: null, candidateIds: [], relatedIds: [] }))
      return
    }
    yield* textResponse('好')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const { input } = await ask(app.gateway, 'FP8 那个跑起来了吗')
    assert.equal(routed.length, 2)
    assert.deepEqual(routed[0].payload.evidence, [{ contextId: 'ctx_qwen_9070xt', terms: ['fp8'], strong: true }])
    assert.deepEqual(routed[1].payload.recheck, { previous: 'ctx_thesis', contextId: 'ctx_qwen_9070xt', terms: ['fp8'] })
    assert.ok((routed[1].maxTokens ?? 0) > (routed[0].maxTokens ?? 0), 'the second call leaves room to think')
    assert.equal(app.ctx.theone.store.route(input.id)?.decision.contextId, 'ctx_qwen_9070xt')
    // Agreeing with the clue needs no second call.
    await ask(app.gateway, 'FP8 再试一次')
    assert.equal(routed.length, 3)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
