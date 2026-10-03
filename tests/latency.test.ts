import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { continuesCurrent } from '../src/routing-policy.ts'
import { harness, ask, textResponse } from './harness.ts'

test('only bare acknowledgements and "go on" skip the classifier', () => {
  for (const text of ['好的', '继续', '继续写', '然后呢？', '为什么', '谢谢！', 'ok', 'Go on.', '详细点', '嗯嗯'])
    assert.equal(continuesCurrent(text), true, text)
  for (const text of ['好的，帮我写一首关于秋天的诗', '继续上次的论文', '为什么天空是蓝色的', '怎么做红烧肉', '你帮我查下天气', 'ok but switch to the budget sheet'])
    assert.equal(continuesCurrent(text), false, text)
})

test('a short continuation of the mounted topic answers without a routing call', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-fast-keep-'))
  const app = await harness(root, undefined, { routerMode: 'llm' })
  try {
    app.model.behavior = async function* (options) {
      if (options.system === ROUTING_PROMPT)
        yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: 'ctx_qwen_9070xt', title: null, question: null, reason: '继续配置' }))
      else yield* textResponse('Worker 回答')
    }
    const routed = () => app.model.requests.filter(request => request.system === ROUTING_PROMPT).length
    const first = await ask(app.gateway, '继续 Qwen 配置')
    assert.equal(first.output, 'Worker 回答')
    assert.equal(routed(), 1)
    const ack = await ask(app.gateway, '好的')
    assert.equal(ack.output, 'Worker 回答')
    assert.equal(routed(), 1)
    const route = app.ctx.theone.store.route(ack.input.id)
    assert.equal(route?.decision.action, 'KEEP')
    assert.equal(route?.decision.contextId, 'ctx_qwen_9070xt')
    await ask(app.gateway, '好的，那换成 Llama 再配一遍')
    assert.equal(routed(), 2)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('catalog review pages are classified concurrently with the same in-order result', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-parallel-review-'))
  const app = await harness(root, undefined, { routerMode: 'llm', historyCatalog: true })
  try {
    await app.ctx.theone.catalog!.refresh()
    app.ctx.theone.store.seed(Array.from({ length: 40 }, (_, i) => ({ id: `page-${String(i).padStart(3, '0')}`, title: `历史项目 ${i}`, summary: '不同的项目', entities: [], keywords: [], lastState: '待续' })))
    app.ctx.theone.catalog!.candidates = async () => app.ctx.theone.store.contexts().slice(0, 16)
    let calls = 0, inFlight = 0, peak = 0
    const allReviewsStarted = Promise.withResolvers<void>()
    app.model.behavior = async function* (options) {
      if (options.system !== ROUTING_PROMPT) { yield* textResponse('新事项已处理'); return }
      const call = ++calls
      if (call > 1) {
        inFlight++; peak = Math.max(peak, inFlight)
        if (inFlight >= 2) allReviewsStarted.resolve()
        // A sequential pass never starts the second review, so this would time out.
        await Promise.race([allReviewsStarted.promise, new Promise(resolve => setTimeout(resolve, 3000))])
        inFlight--
      }
      yield* textResponse(JSON.stringify({ action: 'CREATE', contextId: null, title: '全新的预算表', question: null, reason: '没有匹配', historyIndependent: true }))
    }
    const result = await ask(app.gateway, '帮我做一张全新的家庭预算表')
    assert.equal(result.output, '新事项已处理')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.action, 'CREATE')
    assert.ok(calls >= 3, `routing calls: ${calls}`)
    assert.ok(peak >= 2, `review calls overlapped: ${peak}`)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
