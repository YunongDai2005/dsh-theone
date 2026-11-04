import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { ask, FixtureModel, harness, textResponse } from './harness.ts'

const fixtures = JSON.parse(await readFile(new URL('../eval/fixtures/routing-flow.json', import.meta.url), 'utf8')) as {
  id: string; text: string; current?: string; empty?: boolean; large?: boolean; answer: string; want: string; auto?: boolean; layers: string[]
}[]
const baselinePath = new URL('../eval/fixtures/routing-flow-baseline.json', import.meta.url)
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const contexts = (fixture: typeof fixtures[number]) => fixture.empty ? [] : fixture.large
  ? Array.from({ length: 55 }, (_, i) => ({ id: `old-${String(i).padStart(3, '0')}`, title: `Unrelated work ${i}`, summary: 'An old independent project', entities: [], keywords: [], lastState: 'waiting' }))
  : [{ id: 'a', title: 'Design', summary: 'Architecture choices', entities: [], keywords: [], lastState: 'waiting' },
    { id: 'b', title: 'Inference', summary: 'fp8 experiments', entities: [], keywords: [], lastState: 'waiting' }]
const create = { action: 'CREATE', contextId: null, title: 'Pottery', reason: 'new', question: null, historyIndependent: true }
function answer(fixture: typeof fixtures[number], payload: any) {
  if (fixture.answer === 'error') throw new Error('offline failure')
  if (fixture.answer === 'unclear') return { action: 'CLARIFY', contextId: null, reason: 'unclear', question: 'Which plan?', candidateIds: fixture.empty ? [] : ['a', 'b'] }
  if (fixture.answer === 'recheck-invalid') return payload.recheck ? { action: 'invalid' } : create
  if (fixture.answer === 'create') return create
  if (fixture.large) return payload.contexts.some((c: any) => c.id === 'old-016')
    ? { action: fixture.answer === 'review-invalid' ? 'invalid' : 'EXISTING', contextId: 'old-016', reason: 'found', title: null, question: null } : create
  return { action: 'EXISTING', contextId: fixture.answer === 'conflict' && payload.recheck ? 'b' : 'a', reason: 'fixture', title: null, question: null }
}
const fingerprint = (requests: unknown[]) => createHash('sha256').update(JSON.stringify(requests)).digest('hex')

for (const routingShadow of [false, true]) for (const fixture of fixtures) test(`product/replay parity: ${fixture.id} (shadow=${routingShadow})`, { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-routing-parity-'))
  const descriptorPath = join(root, 'contexts.json')
  const catalog = contexts(fixture)
  await writeFile(descriptorPath, JSON.stringify(catalog))
  const model = new FixtureModel()
  const requests: unknown[] = []
  model.behavior = async function* (options) {
    if (!options.system?.startsWith(ROUTING_PROMPT)) { yield* textResponse(''); return }
    const user = (options.messages[0].content[0] as { text: string }).text
    requests.push({ system: options.system, user, maxTokens: options.maxTokens })
    for (const chunk of textResponse(JSON.stringify(answer(fixture, JSON.parse(user))))) {
      if (chunk.type === 'usage') yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 7 } }
      else yield chunk
    }
  }
  const app = await harness(root, model, { descriptorPath, routerMode: 'llm', historyCatalog: true, theoneConfig: { routingShadow, routeNotice: 'all' } })
  try {
    await app.ctx.theone.catalog!.close()
    if (fixture.current) app.ctx.theone.store.mount('test-gateway', fixture.current)
    const { input, end } = await ask(app.gateway, fixture.text)
    assert.equal(end?.data.reason.kind, 'completed', 'telemetry must remain serializable on visible route notices')
    const route = app.ctx.theone.store.route(input.id)!
    assert.ok(route, 'the real gateway must plan the input')
    const receipt = app.ctx.theone.store.recentRoutes('test-gateway', 1)[0].receipt as any
    const selected = route.decision.action === 'CREATE' ? 'CREATE' : route.decision.contextId
    assert.equal(selected, fixture.want)
    assert.equal(requests.length, fixture.layers.length)
    const frozen = { requestHash: fingerprint(requests), calls: requests.length, action: route.decision.action, selected }
    assert.deepEqual(frozen, baseline[fixture.id], 'product requests and decisions must match the retry/aside protocol baseline')
    assert.ok(receipt.trace, 'persist the whole routing chain, not just the final tier')
    assert.equal(receipt.trace.autoSettled, !!fixture.auto)
    assert.deepEqual(receipt.callDetails.map((call: any) => call.layer), fixture.layers)
    assert.ok(receipt.callDetails.every((call: any) => typeof call.elapsedMs === 'number'))
    const { routeSession } = await import(new URL('../eval/run-router.mjs', import.meta.url).href)
    const replayRequests: unknown[] = []
    const client = { model: 'fixture', complete: async (request: any) => {
      replayRequests.push({ system: request.system, user: request.user, maxTokens: request.maxTokens })
      return { value: JSON.stringify(answer(fixture, JSON.parse(request.user))), usage: { input: 17, output: 3, cached: 7 }, calls: 1, latency_ms: 1,
        usage_by_call: [{ input: 17, output: 3, cache_hit: 7 }] }
    } }
    const [row] = await routeSession({ session_id: fixture.id, catalog, current_id: fixture.current, threads: [], turns: [{ i: 0, text: fixture.text }] }, { mode: 'closed', policy: 'theone', client, routingShadow })
    assert.deepEqual(replayRequests, requests)
    assert.equal(row.action, route.decision.action)
    assert.equal(row.action === 'CREATE' ? 'CREATE' : row.pred, selected)
    assert.deepEqual(row.trace.candidateIds, receipt.trace.candidateIds)
    assert.deepEqual(row.trace.initial, receipt.trace.initial)
    assert.deepEqual(row.trace.recheck, receipt.trace.recheck)
    assert.deepEqual(row.trace.review, receipt.trace.review)
    assert.equal(row.trace.autoSettled, receipt.trace.autoSettled)
    assert.deepEqual(row.usage_by_call.map((call: any) => call.layer), fixture.layers)
    assert.equal(row.replay, 'product-v1')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

