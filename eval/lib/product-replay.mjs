// Run the installed product in an isolated DSH runtime. Only the model transport is
// supplied by evaluation; candidate search, correction, review, settlement, state,
// planning and receipts all execute dist/index.js. No host profile is loaded.
import { Context } from '@deepseek-ai/cordis'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import TheOne, { TERMS_PROMPT } from '../../dist/index.js'
import { ROUTING_PROMPT } from '../../dist/llm-router.js'
import { CARD_PROMPT } from '../../dist/topic-memory.js'

function* textResponse(text, usage) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  if (usage) yield { type: 'usage', usage: { inputTokens: usage.input - (usage.cached ?? 0), outputTokens: usage.output, cacheReadTokens: usage.cached } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

class ReplayModel extends LlmAdapter {
  records = []
  cardRecords = []
  auxiliaryRecords = []
  tag = ''
  reply = ''
  constructor(client) { super(); this.client = client }
  providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'replay.retry') }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    const routing = options.system?.startsWith(ROUTING_PROMPT)
    const card = options.system === CARD_PROMPT
    const terms = options.system === TERMS_PROMPT
    if (!routing && !card && !terms) {
      // No worker tools or real worker model calls. Optional observed replies are
      // supplied by the dataset, never inferred from its gold topic labels.
      yield* textResponse(this.reply)
      return
    }
    const records = routing ? this.records : card ? this.cardRecords : this.auxiliaryRecords
    const record = {}
    records.push(record) // Reserve invocation order before concurrent pages finish.
    const user = options.messages[0].content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const payload = JSON.parse(user)
    const tag = `${card ? 'card' : terms ? 'terms' : 'route'}:${this.tag}:${payload.recheck ? 'recheck:' : ''}${records.length}`
    try {
      const answer = await this.client.complete({ system: options.system, user, maxTokens: options.maxTokens,
        json: false, details: true, tag, ...(payload.recheck ? { override: { reasoning_effort: null, thinking: null } } : {}) })
      Object.assign(record, answer)
      yield* textResponse(typeof answer.value === 'string' ? answer.value : JSON.stringify(answer.value), answer.usage)
    } catch (error) { Object.assign(record, error); throw error }
  }
}

/** Physical transport attempts, including failures/retries; disk-cache hits sent none. */
function transportCalls(records, detailAt) {
  return records.flatMap((record, index) => {
    const detail = detailAt(index)
    const count = record.calls ?? (record.cached ? 0 : 1)
    const usage = record.usage_by_call ?? (count ? [{ input: record.usage?.input, cache_hit: record.usage?.cached, output: record.usage?.output }] : [])
    if (usage.length !== count) throw new Error('Incomplete per-call transport telemetry')
    return usage.map((used, attempt) => ({ layer: detail?.layer ?? 'quick', ...used,
      latency_ms: record.latency_by_call?.[attempt] ?? (count === 1 ? record.latency_ms ?? detail?.elapsedMs : null) }))
  })
}

export function validatePredictionKeys(sessions, rows) {
  const expected = new Set()
  for (const session of sessions) for (const turn of session.turns) {
    const key = JSON.stringify([session.session_id, turn.i])
    if (expected.has(key)) throw new Error(`Duplicate input: ${key}`)
    expected.add(key)
  }
  const seen = new Set()
  for (const row of rows) {
    const key = JSON.stringify([row.session_id, row.i])
    if (seen.has(key)) throw new Error(`Duplicate prediction: ${key}`)
    if (!expected.has(key)) throw new Error(`Unexpected prediction: ${key}`)
    if (typeof row.pred !== 'string' || !row.pred) throw new Error(`Missing prediction value: ${key}`)
    seen.add(key)
  }
  for (const key of expected) if (!seen.has(key)) throw new Error(`Missing prediction: ${key}`)
}

export async function routeSession(session, { mode = 'closed', policy = 'theone', client, merge = 'none', decide = 'joint', cards = false, routingShadow = true } = {}) {
  if (policy !== 'theone' || merge !== 'none' || decide !== 'joint')
    throw new Error('product-v1 uses the product policy and sequential arrivals; use --replay legacy-v0 for policy/burst ablations')
  if (!['open', 'closed'].includes(mode)) throw new Error('--mode open|closed')
  validatePredictionKeys([session], session.turns.map(turn => ({ session_id: session.session_id, i: turn.i, pred: 'pending' })))
  const root = await mkdtemp(join(tmpdir(), 'theone-product-replay-'))
  const ctx = new Context()
  const model = new ReplayModel(client)
  const gatewayKey = 'replay'
  const rows = []
  try {
    const catalog = session.catalog ?? (mode === 'closed' ? session.threads.map(thread => ({ id: thread.id, title: thread.title,
      summary: thread.description || thread.title, entities: [], keywords: [], lastState: 'waiting' })) : [])
    const descriptorPath = join(root, 'contexts.json')
    await writeFile(descriptorPath, JSON.stringify(catalog))
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: 'Replay assistant.' })
    await ctx.plugin(Tools)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(SessionQuery, { path: join(root, 'fts.db') })
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['replay'], model)
    await ctx.plugin(DefaultModel, { provider: 'replay', model: client.model ?? 'fixture' })
    await ctx.plugin(TheOne, { databasePath: join(root, 'contexts.db'), contextsPath: descriptorPath, gatewayKey,
      historyCatalog: true, routerMode: 'llm', workerProvider: 'replay', workerModel: client.model ?? 'fixture',
      maxDescriptorChars: 4000, maxResponseChars: 100000, topicCards: cards, routingShadow })
    // The snapshot is the catalog. Background indexing would introduce unseen
    // data/model calls; candidates() still uses the real local search service.
    await ctx.theone.catalog.close()
    const gateway = (await ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'theone', model: 'gateway' } })).agent
    if (session.current_id) ctx.theone.store.mount(gatewayKey, session.current_id)
    for (const turn of session.turns) {
      model.tag = `product-v1:${session.session_id}:${turn.i}:${mode}`
      model.records = []; model.cardRecords = []; model.auxiliaryRecords = []; model.reply = turn.reply ?? ''
      const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: turn.text }] })
      const started = performance.now()
      gateway.followup(input)
      await gateway.whenIdle()
      await ctx.theone.learning
      if (cards) await ctx.theone.work.scheduler.tick()
      const route = ctx.theone.store.route(input.id)
      const saved = ctx.theone.store.recentRoutes(gatewayKey, 1)[0]
      if (!route || saved?.messageId !== input.id || !saved.receipt?.trace) throw new Error(`Missing prediction/receipt: ${session.session_id}:${turn.i}`)
      const receipt = saved.receipt
      const sent = receipt.callDetails.filter(call => call.sent)
      const calls = transportCalls(model.records, index => sent[index])
      const cardUsage = transportCalls(model.cardRecords, () => ({ layer: 'card' }))
      const auxiliaryUsage = transportCalls(model.auxiliaryRecords, () => ({ layer: 'terms' }))
      const usage = calls.reduce((total, call) => ({ input: total.input + (call.input ?? 0), output: total.output + (call.output ?? 0), cache_hit: total.cache_hit + (call.cache_hit ?? 0) }), { input: 0, output: 0, cache_hit: 0 })
      rows.push({ session_id: session.session_id, i: turn.i, replay: 'product-v1', mode, policy,
        pred: route.decision.action === 'CLARIFY' ? 'CLARIFY' : route.decision.contextId ?? 'ERROR', action: route.decision.action,
        refs: route.decision.relatedIds ?? [], decision: route.decision, trace: receipt.trace, call_details: receipt.callDetails,
        tier: receipt.tier === 'rules' && !receipt.calls ? 'fast' : receipt.tier, via: receipt.mode,
        calls: calls.length, logical_calls: receipt.calls, usage_by_call: calls, usage,
        latency_ms: calls.reduce((sum, call) => sum + (call.latency_ms ?? 0), 0), elapsed_ms: Math.round(performance.now() - started),
        ...(receipt.errorCode ? { error: receipt.errorCode } : {}),
        ...(cards ? { card_usage: cardUsage } : {}),
        ...(auxiliaryUsage.length ? { auxiliary_usage: auxiliaryUsage } : {}) })
    }
    validatePredictionKeys([session], rows)
    return rows
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}
