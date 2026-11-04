import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DshRouter, RouterFailure, validateRoutingDecision } from '../src/llm-router.ts'
import { textResponse } from './harness.ts'

const A = 'topic-research-long-identifier', B = 'topic-shopping-long-identifier'
const contexts = [
  { id: A, title: 'Research', summary: 'Research work', entities: [], keywords: [], lastState: '' },
  { id: B, title: 'Shopping', summary: 'Shopping list', entities: [], keywords: [], lastState: '' },
]
const input = { text: 'Continue the research plan', contexts }
const create = { action: 'CREATE', title: 'Research', reason: '  Model explanation  ' }

for (const [currentId, action] of [[undefined, 'MOUNT'], [A, 'KEEP'], [B, 'SWAP']] as const) {
  test(`a CREATE naming one existing topic becomes ${action}`, () => {
    assert.deepEqual(validateRoutingDecision(create, { ...input, currentId }),
      { action, contextId: A, reason: '  Model explanation  ' })
  })
}

for (const [title, offeredTitle] of [['  rEsEaRcH\t', 'Research'], ['Research', ' \tRESEARCH  ']]) {
  test(`duplicate titles ignore case and outer whitespace: ${JSON.stringify([title, offeredTitle])}`, () => {
    assert.deepEqual(validateRoutingDecision({ ...create, title }, { ...input, contexts: [{ ...contexts[0], title: offeredTitle }, contexts[1]] }),
      { action: 'MOUNT', contextId: A, reason: '  Model explanation  ' })
  })
}

test('multiple title matches still fail with duplicate-title', () => {
  assert.throws(() => validateRoutingDecision(create, { ...input, contexts: [contexts[0], { ...contexts[1], title: '  RESEARCH\t' }] }),
    (error: unknown) => error instanceof RouterFailure && error.code === 'ROUTER_INVALID_DECISION' && error.detail === 'duplicate-title')
})

test('a duplicate CREATE filters references and imports and drops CREATE-only fields', () => {
  const facts = [{ id: 'fact1', topic: 'Shopping', label: 'Budget', kind: 'fact' as const, value: '100' }]
  assert.deepEqual(validateRoutingDecision({ ...create, relatedIds: [A, B, B, 'unknown'], imports: ['fact1', 'unknown', 'fact1', 4],
    aside: true, historyIndependent: true, projectId: 'project1' }, { ...input, facts, projects: [{ id: 'project1', name: 'Project' }] }),
  { action: 'MOUNT', contextId: A, reason: '  Model explanation  ', relatedIds: [B], imports: ['fact1'] })
})

test('a duplicate CREATE still validates its original field shapes', () => {
  for (const [fields, detail] of [[{ historyIndependent: 'true' }, 'bad-history-independent'], [{ aside: 'true' }, 'bad-aside'],
    [{ relatedIds: B }, 'bad-related-ids'], [{ contextId: A }, 'unexpected-context-id'], [{ question: 'Which?' }, 'unexpected-question']] as const) {
    assert.throws(() => validateRoutingDecision({ ...create, ...fields }, input),
      (error: unknown) => error instanceof RouterFailure && error.detail === detail)
  }
})

for (const variant of ['compact', 'snapshot+compact'] as const) {
  test(`${variant} expands routeIds before converting a duplicate CREATE without retrying`, async () => {
    let calls = 0
    const llm = {
      resolveModelInfo: async (provider: string, id: string) => ({ provider, id, name: id }),
      prepareCall: async () => ({ config: { provider: 'fixture', model: 'fixture' }, stream: function* (options: { messages: { content: { text: string }[] }[] }) {
        calls++
        const wire = JSON.parse(options.messages[0].content[0].text)
        const payload = wire.snapshot ?? wire
        assert.notEqual(payload.contexts[0].routeId, A)
        assert.notEqual(payload.contexts[1].routeId, B)
        yield* textResponse(JSON.stringify({ ...create, relatedIds: [payload.contexts[0].routeId, payload.contexts[1].routeId],
          imports: ['fact1'], aside: true, historyIndependent: true, projectId: 'project1' }))
      } }),
    }
    const router = new DshRouter(llm as never, () => ({ provider: 'fixture', model: 'fixture' }), 30000, Date.now, variant)
    const result = await router.decide({ ...input, currentId: B,
      facts: [{ id: 'fact1', topic: 'Shopping', label: 'Budget', kind: 'fact', value: '100' }], projects: [{ id: 'project1', name: 'Project' }] })
    assert.deepEqual(result.decision, { action: 'SWAP', contextId: A, reason: '  Model explanation  ', relatedIds: [B], imports: ['fact1'] })
    assert.equal(calls, 1)
    assert.equal(result.attempts?.length, 1)
  })
}
