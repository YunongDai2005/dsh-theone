import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { ContextStore, TERM_HALF_LIFE_MS } from '../src/store.ts'
import { HistoryCatalog } from '../src/history-catalog.ts'
import { ROUTING_PROMPT, routingPayload } from '../src/llm-router.ts'
import { similarity, textFeatures } from '../src/routing-policy.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

const topic = (id: string, title: string, keywords: string[] = []) => ({ id, title, summary: title, entities: [], keywords, lastState: '进行中' })

test('learned terms strengthen, fade, can be unlearned, and only count above a threshold', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic('a', '论文'), topic('b', '显卡')])
    const t0 = 1_000_000
    store.learnTerms('b', ['显存设置'], 0.5, t0)
    assert.equal(store.learnedTerms(t0).get('b'), undefined, 'one weak hint does not count even within the same millisecond')
    store.learnTerms('b', ['显存设置'], 0.5, t0)
    assert.deepEqual(store.learnedTerms(t0).get('b'), ['显存设置'])
    store.learnTerms('a', ['消融', '第三章', 'x'], 1, t0)
    assert.deepEqual(store.learnedTerms(t0).get('a'), ['消融', '第三章'])
    // Fading: after two half-lives a single confirmation is below the threshold.
    assert.equal(store.learnedTerms(t0 + 2 * TERM_HALF_LIFE_MS).get('a'), undefined)
    store.learnTerms('a', ['消融'], 1, t0)
    store.learnTerms('a', ['第三章'], -1, t0)
    assert.deepEqual(store.learnedTerms(t0).get('a'), ['消融'])
    store.learnTerms('missing', ['消融'], 1, t0)
    store.deleteTopic('a')
    assert.equal(store.learnedTerms(t0).get('a'), undefined)
  } finally { store.close() }
})

test('similar messages share features; unrelated ones do not', () => {
  const ask1 = textFeatures('把消融表格再整理一下')
  assert.ok(similarity(ask1, textFeatures('Qwen 的消融表格')) > 0.3)
  assert.ok(similarity(ask1, textFeatures('明天去京都的酒店订好了吗')) < 0.12)
})

test('candidate recall uses learned terms and favours recently used and linked topics', async () => {
  const store = new ContextStore(':memory:')
  try {
    const many = Array.from({ length: 24 }, (_, index) => topic(`t${String(index).padStart(2, '0')}`, `话题${index}`))
    store.seed(many)
    const catalog = new HistoryCatalog({ sessionQuery: { searchSessions: async () => ({ items: [] }) } } as never, store, () => ({ provider: 'x', model: 'y' }))
    const contexts = store.contexts().map(context => context.id === 't23' ? { ...context, keywords: ['显存设置'] } : context)
    const picked = await catalog.candidates('显存设置怎么调', undefined, undefined, { contexts, prior: new Map([['t22', 6]]) })
    assert.deepEqual(picked.slice(0, 2).map(context => context.id), ['t23', 't22'])
    assert.equal(picked.length, 16)
  } finally { store.close() }
})

test('corrections teach terms the model picks from the message, examples are chosen by similarity, and the directory shows how routing is doing', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-route-learning-'))
  const payloads: ReturnType<typeof routingPayload>[] = []
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system === ROUTING_PROMPT) {
      payloads.push(JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text))
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: 'ctx_qwen_9070xt', title: null, question: null, reason: '提到 Qwen' }))
      return
    }
    if (options.system?.includes('从用户的更正中学习')) {
      // One invented term is dropped: learned terms must appear in the message.
      assert.equal(options.maxTokens, 256)
      yield* textResponse(JSON.stringify(['消融表格', '不存在的词']))
      return
    }
    yield* textResponse('好')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    const post = (path: string, body: unknown) => handler.fetch(new Request(`http://dsh.internal/api/theone/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    const first = await ask(app.gateway, 'Qwen 的消融表格')
    const other = await ask(app.gateway, 'Qwen 显存又爆了')
    assert.equal((await post('routes', { messageId: first.input.id, contextId: 'ctx_thesis' })).status, 200)
    await app.ctx.theone.learning
    assert.deepEqual(app.ctx.theone.store.learnedTerms().get('ctx_thesis'), ['消融表格'])
    // Only the correction like this message is offered as an example.
    await ask(app.gateway, '把消融表格再整理一下')
    assert.deepEqual(payloads.at(-1)!.corrections, [{ text: 'Qwen 的消融表格', rightId: 'ctx_thesis', wrongId: 'ctx_qwen_9070xt' }])
    await ask(app.gateway, '明天订京都的酒店')
    assert.equal(payloads.at(-1)!.corrections, undefined)
    // The learned term reaches the classifier as part of the topic.
    assert.ok(payloads.at(-1)!.contexts.find(context => context.id === 'ctx_thesis')!.keywords.includes('消融表格'))
    const listed = await (await handler.fetch(new Request('http://dsh.internal/api/theone/routes'))).json() as { stats: { total: number; corrected: number } }
    assert.equal(listed.stats.total, 4)
    assert.equal(listed.stats.corrected, 1)
    assert.ok(other)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('opening another topic right after a message went elsewhere is a weak hint, not a correction', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-route-hint-'))
  const app = await harness(root)
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    const routed = await ask(app.gateway, 'Qwen 的显存设置')
    const response = await handler.fetch(new Request('http://dsh.internal/api/theone/context/mount', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contextId: 'ctx_thesis' }) }))
    assert.equal(response.status, 200)
    await app.ctx.theone.learning
    // Half a confirmation: recorded, but below the threshold until it happens again.
    assert.equal(app.ctx.theone.store.learnedTerms().get('ctx_thesis'), undefined)
    assert.equal(app.ctx.theone.store.recentRoutes('test-gateway').find(route => route.messageId === routed.input.id)?.correctedTo, undefined)
    app.ctx.theone.store.learnTerms('ctx_thesis', ['显存设置'], 0.5)
    assert.deepEqual(app.ctx.theone.store.learnedTerms().get('ctx_thesis'), ['显存设置'])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
