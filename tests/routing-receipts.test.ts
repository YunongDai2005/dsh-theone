import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { ask, FixtureModel, harness, textResponse } from './harness.ts'

const create = { action: 'CREATE', contextId: null, title: 'An independent new task', question: null, historyIndependent: true, reason: 'new' }
function* response(value: unknown) {
  for (const chunk of textResponse(JSON.stringify(value))) {
    if (chunk.type === 'usage') yield { type: 'usage' as const, usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 7 } }
    else yield chunk
  }
}

test('a rejected second look retains the quick tier and counts the failed retry and all cached tokens', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-receipt-recheck-'))
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse(JSON.stringify(options.messages[0].content[0])).text
      const second = JSON.parse(payload).recheck
      yield* response(second ? { ...create, action: 'invalid' } : create)
    } else yield* textResponse('done')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const { input } = await ask(app.gateway, 'Plan a pottery class for Saturday')
    assert.equal(app.ctx.theone.store.route(input.id)?.decision.action, 'CREATE')
    const receipt = app.ctx.theone.store.recentRoutes('test-gateway', 1)[0].receipt as Record<string, unknown>
    assert.deepEqual([receipt.tier, receipt.calls, receipt.cacheHitTokens, receipt.promptTokens], ['quick', 3, 21, 51])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

for (const failReview of [false, true]) {
  test(`all concurrent review pages count, including pages after a match (failed page: ${failReview})`, { timeout: 30000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'theone-receipt-review-'))
    const model = new FixtureModel()
    const app = await harness(root, model, { routerMode: 'llm', historyCatalog: true })
    try {
      await app.ctx.theone.catalog!.refresh()
      app.ctx.theone.store.seed(Array.from({ length: 55 }, (_, i) => ({ id: `old-${String(i).padStart(3, '0')}`, title: `Unrelated work ${i}`,
        summary: 'An old independent project', entities: [], keywords: [], lastState: 'waiting' })))
      const catalog = app.ctx.theone.store.contexts().map(c => c.id)
      const firstIds = new Set(catalog.slice(0, 16))
      const target = catalog.filter(id => !firstIds.has(id))[0]
      app.ctx.theone.catalog!.candidates = async () => app.ctx.theone.store.contexts().slice(0, 16).reverse()
      let calls = 0
      model.behavior = async function* (options) {
        if (options.system?.startsWith(ROUTING_PROMPT)) {
          calls++
          const payload = JSON.parse(JSON.stringify(options.messages[0].content[0])).text
          const data = JSON.parse(payload)
          const ids = data.contexts.map((c: { id: string }) => c.id)
          assert.deepEqual(ids, catalog.filter(id => ids.includes(id)), 'ranked candidates and every review page use the full catalog order')
          const found = ids.includes(target)
          // All three review requests have been sent, even when the first page settles the route.
          yield* response(found ? { action: failReview ? 'invalid' : 'EXISTING', contextId: target, title: null, question: null, reason: 'found' } : create)
        } else yield* textResponse('done')
      }
      const { input } = await ask(app.gateway, 'Could we pick up that old project again?')
      assert.equal(calls, failReview ? 6 : 5, 'quick, second look, three concurrent catalog pages and a failed-page retry')
      const receipt = app.ctx.theone.store.recentRoutes('test-gateway', 1)[0].receipt as Record<string, unknown>
      assert.deepEqual([receipt.tier, receipt.calls, receipt.cacheHitTokens, receipt.promptTokens, receipt.completionTokens],
        [failReview ? 'rules' : 'review', failReview ? 6 : 5, failReview ? 42 : 35, failReview ? 102 : 85, failReview ? 18 : 15])
      if (!failReview) assert.equal(app.ctx.theone.store.route(input.id)?.decision.contextId, target)
    } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
  })
}