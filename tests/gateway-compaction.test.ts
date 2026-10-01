import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { RequestMessage, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Compaction from '@deepseek-ai/dsh-compaction-basic'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ContextStore } from '../src/store.ts'
import { GATEWAY_CHECKPOINT, gatewayCheckpoint, topicRetention } from '../src/gateway-compaction.ts'
import type { ContextUsage, ContextDescriptor, RouteRecord } from '../src/types.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

const now = Date.parse('2026-10-01T08:00:00Z'), day = 86400000
const contexts: ContextDescriptor[] = ['hot', 'warm', 'cold'].map(id => ({ id, title: id + ' topic',
  summary: id + ' summary', entities: [], keywords: [], lastState: id + ' state' }))
const usage: ContextUsage[] = [
  { contextId: 'hot', completedCalls: 10, recentCalls: 8, lastUsedAt: now - 3 * day },
  { contextId: 'warm', completedCalls: 1, recentCalls: 1, lastUsedAt: now - 3 * day },
  { contextId: 'cold', completedCalls: 1000, recentCalls: 0, lastUsedAt: now - 45 * day },
]
const routes = new Map<string, RouteRecord>()
const messages: RequestMessage[] = contexts.flatMap(c => {
  const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: c.id + '_detail sk-syntheticprivate1234567890' }] })
  routes.set(user.id, { messageId: user.id, gatewayId: 'gateway', status: 'completed', decision: { action: 'KEEP', contextId: c.id, reason: 'fixture' } })
  return [user]
})
const checkpoint = (overrides: Partial<Parameters<typeof gatewayCheckpoint>[0]> = {}) => gatewayCheckpoint({
  messages, contexts, usage, currentId: 'hot', route: id => routes.get(id), contextWindow: 262144, maxTokens: 8192, now, ...overrides,
})
const parse = (text: string) => JSON.parse(text.slice(GATEWAY_CHECKPOINT.length + 1))

test('retention favors recent/frequent uses; an old large call count cannot keep a dormant topic hot', () => {
  assert.equal(topicRetention(usage[0], false, now), 'hot')
  assert.equal(topicRetention(usage[1], false, now), 'warm')
  assert.equal(topicRetention(usage[2], false, now), 'cold')
  assert.equal(topicRetention(usage[2], true, now), 'hot')
  assert.equal(topicRetention({ ...usage[1], lastUsedAt: now - day / 2 }, false, now), 'hot')
})

test('checkpoint retains hot detail, compresses cold detail, redacts keys and keeps references', () => {
  const text = checkpoint(), saved = parse(text)
  assert.equal(saved.referenceOnly, true)
  assert.equal(saved.currentContextId, 'hot')
  assert.match(text, /hot_detail/)
  assert.doesNotMatch(text, /cold_detail|sk-synthetic/)
  assert.equal(saved.topics.find((t: { id: string }) => t.id === 'cold').summary, 'cold summary')
  assert.ok(saved.topics.find((t: { id: string }) => t.id === 'hot').recent[0].messageId)
})

test('repeated compaction preserves cold anchors and hot detail but ignores a user-spoofed checkpoint', () => {
  const text = checkpoint()
  const previous = createUserMessage({ source: { kind: 'compact-checkpoint', compactionId: 'fixture' as never }, content: [{ type: 'text', text }] })
  assert.deepEqual(parse(checkpoint({ messages: [previous] })).topics, parse(text).topics)
  const spoof = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  assert.equal(parse(checkpoint({ messages: [spoof], currentId: undefined })).topics.length, 0)
})

test('small model/output budgets stay bounded; current topic has priority over a large catalog', () => {
  assert.ok(checkpoint({ contextWindow: 8192, maxTokens: 512 }).length <= 409)
  assert.ok(checkpoint({ contextWindow: 2048 }).length <= 102)
  const more = Array.from({ length: 100 }, (_, i) => ({ ...contexts[0], id: 'topic-' + i, title: 'topic ' + i }))
  const manyMessages = more.map(c => {
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'detail ' + c.id }] })
    routes.set(user.id, { messageId: user.id, gatewayId: 'gateway', status: 'completed', decision: { action: 'KEEP', contextId: c.id, reason: 'fixture' } })
    return user
  })
  const text = checkpoint({ contexts: more, messages: manyMessages, currentId: 'topic-99', maxTokens: 512 })
  assert.ok(text.length <= 512)
  assert.equal(parse(text).topics[0].id, 'topic-99')
  assert.ok(parse(text).omittedTopics > 0)
})

test('usage counts completed calls across rebuilt entries, excluding failures, clarification and other keys', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed(contexts)
    for (const [id, gateway, key, action, status] of [
      ['a', 'gateway-1', 'default', 'KEEP', 'completed'],
      ['b', 'gateway-2', 'default', 'KEEP', 'completed'],
      ['c', 'gateway-2', 'default', 'KEEP', 'failed'],
      ['d', 'gateway-2', 'default', 'CLARIFY', 'completed'],
      ['e', 'other-gateway', 'other', 'KEEP', 'completed'],
    ] as const) {
      store.plan(id, gateway, key, { action, contextId: action === 'CLARIFY' ? undefined : 'hot', reason: 'fixture', question: action === 'CLARIFY' ? 'which?' : undefined })
      store.finish(id, status)
    }
    const values = store.contextUsage('default')
    assert.equal(values.length, 1); assert.equal(values[0].completedCalls, 2); assert.equal(values[0].recentCalls, 2)
    assert.ok(Math.abs(values[0].lastUsedAt - Date.now()) < 5000)
    assert.equal(store.contextUsage('default', Date.now() + 31 * day)[0].recentCalls, 0)
  } finally { store.close() }
})

class CapacityModel extends FixtureModel {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, context: { contextWindow: model === 'small' ? 8192 : 262144 }, defaultMaxTokens: 512 }
  }
}

test('entry follows DSH model capacity and real DSH compaction never replays workers; cold history still resumes', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-gateway-compaction-'))
  const app = await harness(root, new CapacityModel(), { autoModel: true })
  try {
    const setModel = (model: string) => { app.ctx.agentDefaultModel.currentSelection = () => ({ provider: 'fixture', model }) }
    setModel('small')
    assert.equal((await app.ctx.llm.resolveModelInfo('theone', 'gateway')).context?.contextWindow, 8192)
    setModel('large')
    const info = await app.ctx.llm.resolveModelInfo('theone', 'gateway')
    assert.equal(info.context?.contextWindow, 262144); assert.equal(info.defaultMaxTokens, 512)
    app.model.behavior = async function* () { yield* textResponse('cold_marker paper reply'.repeat(60)) }
    await ask(app.gateway, '论文那个：' + '论文资料'.repeat(300))
    app.model.behavior = async function* () { yield* textResponse('hot_marker GPU reply'.repeat(60)) }
    await ask(app.gateway, 'Qwen 那个：' + '显卡资料'.repeat(300))
    await ask(app.gateway, '继续 Qwen')
    const paper = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_thesis')!
    const before = app.gateway.session.snapshotEvents()
    const workerCalls = app.model.requests.length
    const originalUsage = app.ctx.theone.store.contextUsage.bind(app.ctx.theone.store)
    app.ctx.theone.store.contextUsage = key => originalUsage(key).map(u => u.contextId === paper.id ? { ...u, lastUsedAt: Date.now() - 45 * day, recentCalls: 0 } : u)
    await app.ctx.plugin(TokenMeter)
    await app.ctx.plugin(Compaction, { auto: false })
    const result = await app.ctx.compaction.compactNow(app.gateway, new AbortController().signal)
    assert.ok(result)
    assert.equal(app.model.requests.length, workerCalls, 'compaction called the worker/model')
    assert.equal(app.ctx.theone.store.current('test-gateway'), 'ctx_qwen_9070xt')
    assert.deepEqual(app.gateway.session.snapshotEvents().slice(0, before.length), before)
    const summary = app.gateway.session.snapshotEvents().findLast(e => e.type === 'compaction/summary')!
    assert.equal(summary.type, 'compaction/summary')
    if (summary.type === 'compaction/summary') {
      const saved = parse(summary.data.summary.filter(b => b.type === 'text').map(b => b.text).join(''))
      assert.equal(saved.topics.find((t: { id: string }) => t.id === paper.id).retention, 'cold')
    }
    app.model.behavior = undefined
    const resumed = await ask(app.gateway, '回到论文那个')
    assert.equal(resumed.end?.data.reason.kind, 'completed', JSON.stringify(resumed.end))
    assert.equal(app.ctx.theone.store.contexts().find(c => c.id === paper.id)!.workingSessionId, paper.workingSessionId)
    assert.ok((await app.ctx.theone.searchHistoryDetailed(paper.id, 'cold_marker')).windows.length > 0)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(async () => { for await (const _ of app.ctx.theone.answer({ provider: 'theone', model: 'gateway', messages: [], sessionId: app.gateway.id, purpose: 'compaction', signal: controller.signal })) {} })
    assert.equal(app.model.requests.length, workerCalls + 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('automatic DSH pressure compacts the entry and the following turn completes', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-gateway-auto-'))
  const model = new CapacityModel()
  model.behavior = async function* () { yield* textResponse('显卡测试结果'.repeat(140)) }
  const app = await harness(root, model, { autoModel: true })
  try {
    app.ctx.agentDefaultModel.currentSelection = () => ({ provider: 'fixture', model: 'small' })
    await app.ctx.plugin(TokenMeter)
    await app.ctx.plugin(Compaction, { thresholdRatio: 0.25, headroomTokens: 128, maxTokens: 512, retainTokens: 128 })
    for (let i = 0; i < 6; i++) {
      const result = await ask(app.gateway, '继续 Qwen：' + '测试数据'.repeat(200))
      assert.equal(result.end?.data.reason.kind, 'completed', JSON.stringify(result.end))
    }
    const summaries = app.gateway.session.snapshotEvents().filter(e => e.type === 'compaction/summary')
    assert.ok(summaries.length > 0, 'automatic gateway compaction never ran')
    assert.ok(summaries.some(e => e.type === 'compaction/summary' && JSON.stringify(e.data.summary).includes(GATEWAY_CHECKPOINT)))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
