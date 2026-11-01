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
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { DatabaseSync } from 'node:sqlite'
import { isRoutingV1, validateRoutingSession } from './routing-v1.mjs'
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
  workerActions = []
  workerInputs = []
  onWorker = undefined
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
      this.workerInputs.push({ sessionId: options.sessionId, messages: options.messages.filter(m => m.role === 'user' && m.source?.kind === 'user')
        .map(m => ({ id: m.id, text: m.content.filter(b => b.type === 'text').map(b => b.text).join('') })) })
      const onWorker = this.onWorker
      this.onWorker = undefined
      if (onWorker) await onWorker()
      const action = this.workerActions.shift()
      if (action) {
        const id = randomUUID()
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: action.name, arguments: JSON.stringify(action.arguments) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
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
        json: false, details: true, tag, session: this.tag.split(':').filter((_, index) => index !== 2).join(':'), ...(payload.recheck ? { override: { reasoning_effort: null, thinking: null } } : {}) })
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

export async function routeSession(session, options = {}) {
  validateRoutingSession(session)
  if (isRoutingV1(session)) return routeEventSession(session, options)
  const { mode = 'closed', policy = 'theone', client, merge = 'none', decide = 'joint', cards = false, routingShadow = true } = options
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


// v1 uses the same real gateway and database as v0, with a separate event driver.
async function openEventRuntime(root, client, { cards, routingShadow }, instance) {
  const ctx = new Context(), model = new ReplayModel(client)
  try {
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
    await ctx.plugin(TheOne, { databasePath: join(root, 'contexts.db'), contextsPath: join(root, 'contexts.json'), gatewayKey: 'replay',
      historyCatalog: true, routerMode: 'llm', workerProvider: 'replay', workerModel: client.model ?? 'fixture',
      maxDescriptorChars: 4000, maxResponseChars: 100000, topicCards: cards, factLinks: true, routingShadow })
    await ctx.theone.catalog.close()
    const gateway = (await ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'theone', model: 'gateway' } })).agent
    const connection = new HostConnectionService(ctx, [], undefined)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise(resolve => setImmediate(resolve))
    return { ctx, model, gateway, instance, connection, handler }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}

async function drainRuntime(app, cards) {
  await app.gateway.whenIdle()
  await app.ctx.theone.learning
  await app.ctx.theone.extracting
  if (cards) await app.ctx.theone.work.scheduler.tick()
  await app.ctx.theone.learning
}

async function closeEventRuntime(app) {
  await drainRuntime(app, false)
  await app.ctx.sessions.flush(app.gateway.session)
  await app.ctx.fiber.dispose()
}

function eventSnapshot(app, root, inputs) {
  const store = app.ctx.theone.store, byMessage = new Map([...inputs].map(([i, message]) => [message.id, i]))
  const source = item => ({ turn_i: byMessage.get(item.messageId) ?? null, context_id: item.contextId, revision: item.revision,
    valid: store.learningJournal.valid([item]) })
  const excluded = store.contexts().flatMap(topic => store.learningJournal.turns(topic.workingSessionId)
    .flatMap(turn => turn.sources.filter(s => !store.learningJournal.valid([s])).map(source)))
  const learned = store.learnedTerms()
  const db = new DatabaseSync(join(root, 'contexts.db'), { readOnly: true })
  let activeSources
  try {
    activeSources = db.prepare('SELECT stream,kind,sources FROM learning_events WHERE active=1').all().map(row => ({
      stream: row.stream, kind: row.kind, sources: JSON.parse(String(row.sources)).map(source) }))
  } finally { db.close() }
  return {
    instance: app.instance, current_id: store.current('replay') ?? null,
    topics: store.contexts().map(topic => ({
      id: topic.id, working_session_id: topic.workingSessionId,
      card: { title: topic.title, summary: topic.summary, entities: topic.entities,
        aliases: store.names(topic.id).get(topic.id) ?? [], settled: store.settled(topic.id), open: store.openItems(topic.id) },
      keywords: [...new Set([...topic.keywords, ...learned.get(topic.id) ?? []])],
      facts: store.facts(topic.id), state: { lastState: topic.lastState, progress: topic.progress, constraints: store.constraints(topic.id) },
    })),
    excluded, active_sources: activeSources,
    shadow: app.ctx.theone.shadow?.snapshot('replay') ?? null,
  }
}

async function routeEventSession(session, { mode = 'closed', policy = 'theone', client, merge = 'none', decide = 'joint',
  cards = false, routingShadow = true, stateAblation = 'none' } = {}) {
  if (!['open', 'closed'].includes(mode)) throw new Error('--mode open|closed')
  if (policy !== 'theone' || merge !== 'none' || decide !== 'joint') throw new Error('routing-v1 uses the product policy')
  if (!['none', 'drop-bindings'].includes(stateAblation)) throw new Error('state ablation must be none|drop-bindings')
  const root = await mkdtemp(join(tmpdir(), 'theone-event-replay-'))
  let app, instance = 0, seq = 0
  const inputs = new Map(), rows = []
  const catalog = session.catalog ?? (mode === 'closed' ? session.threads.map(t => ({
    id: t.id, title: t.title, summary: t.description || t.title, entities: [], keywords: [], lastState: 'waiting' })) : [])
  // Same input consumer as POST /api/theone/messages. Ownership never comes from gold.
  const submit = (turn, mode = 'followup') => app.ctx.theone.submitMessage(app.gateway.id, turn.text,
    stateAblation === 'drop-bindings' ? {} : {
      ...(turn.input?.reply_to ? { replyTo: turn.input.reply_to } : {}),
      ...(turn.input?.pending_response ? { pendingResponse: turn.input.pending_response } : {}),
      ...(turn.input?.steering_of !== undefined ? { steeringOf: inputs.get(turn.input.steering_of).id } : {}),
    }, mode)
  try {
    await writeFile(join(root, 'contexts.json'), JSON.stringify(catalog))
    app = await openEventRuntime(root, client, { cards, routingShadow }, instance)
    if (session.current_id) app.ctx.theone.store.mount('replay', session.current_id)
    for (let position = 0; position < session.turns.length; position++) {
      const turn = session.turns[position], eventResults = [], eventUsage = []
      const reset = () => {
        app.model.tag = `product-v1:${session.session_id}:${turn.i}:${mode}:${stateAblation}`
        app.model.records = []; app.model.cardRecords = []; app.model.auxiliaryRecords = []
        app.model.workerInputs = []; app.model.reply = turn.reply ?? ''
        app.model.workerActions = structuredClone(turn.worker_actions ?? [])
      }
      reset()
      for (const event of turn.events_before ?? []) {
        if (event.type === 'restart') {
          const before = app.instance
          await closeEventRuntime(app)
          app = undefined
          app = await openEventRuntime(root, client, { cards, routingShadow }, ++instance)
          eventResults.push({ ...event, status: 'applied', instance_before: before, instance_after: instance, reused_database: true,
            elapsed_time_applied: false })
          reset()
        } else if (event.type === 'correction') {
          const message = inputs.get(event.turn_i)
          if (!message) throw new Error('Correction missing an earlier runtime message')
          const response = await app.handler.fetch(new Request('http://dsh.internal/api/theone/routes', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageId: message.id, contextId: event.target_topic_id }),
          }), app.connection.browserPeer)
          if (!response.ok) throw new Error('Correction API: ' + response.status + ' ' + await response.text())
          await drainRuntime(app, cards)
          eventUsage.push(...transportCalls(app.model.auxiliaryRecords, () => ({ layer: 'terms' })))
          app.model.auxiliaryRecords = []
          eventResults.push({ ...event, status: 'applied', api: '/api/theone/routes' })
        } else if (stateAblation === 'drop-bindings' && event.type !== 'background') {
          eventResults.push({ ...event, status: 'ablated' })
        } else {
          // Dataset events replace trusted host observations at the product's
          // producer seam. They are not accepted from the public HTTP input API.
          app.ctx.theone.bindings.record({ id: event.id, sessionId: app.gateway.id,
            topicId: event.type === 'pending' ? event.owner_id : event.topic_id,
            kind: event.type === 'pending' ? event.kind : 'reply',
            source: event.type === 'background' ? 'background' : 'foreground', sources: [] })
          const shadow = app.ctx.theone.shadow
          if (shadow) {
            if (event.type === 'pending') shadow.openPending('replay', { topicId: event.owner_id, kind: event.kind,
              messageId: event.message_id, basis: 'host-request' })
            else shadow.record('replay', { messageId: event.id, sessionId: session.session_id + ':events', seq: seq++,
              topicId: event.topic_id, source: event.type, visible: event.type !== 'background' })
          }
          eventResults.push({ ...event, status: 'applied', adapter: 'trusted-host-observation' })
        }
      }
      const before = eventSnapshot(app, root, inputs)
      let input
      const next = session.turns[position + 1]
      const steered = stateAblation === 'none' && next?.input?.steering_of === turn.i ? next : undefined
      let steerInput, steerBefore, routeRecords, workerCount = 0
      if (steered) app.model.onWorker = async () => {
        routeRecords = [...app.model.records]
        app.model.records = []
        steerBefore = eventSnapshot(app, root, inputs)
        workerCount = app.model.workerInputs.length
        app.model.tag = `product-v1:${session.session_id}:${steered.i}:${mode}:${stateAblation}`
        steerInput = submit(steered, 'steer'); inputs.set(steered.i, steerInput)
        // Native sorting is asynchronous. Yield a host tick while the worker is
        // paused here; the existing product decides whether to forward or queue.
        await new Promise(resolve => setImmediate(resolve))
      }
      const started = performance.now()
      input = submit(turn); inputs.set(turn.i, input)
      await drainRuntime(app, cards)
      const after = eventSnapshot(app, root, inputs)
      const rowFor = (t, message, stateBefore, records, extra = {}) => {
        const route = app.ctx.theone.store.route(message.id)
        const saved = app.ctx.theone.store.recentRoutes('replay', session.turns.length + 10).find(r => r.messageId === message.id)
        const receipt = saved?.receipt
        const delivery = extra.delivery
        if (!receipt?.trace && !delivery?.observed) throw new Error(`Missing product receipt/delivery: ${session.session_id}:${t.i}`)
        const sent = receipt?.callDetails?.filter(c => c.sent) ?? []
        const calls = transportCalls(records, i => sent[i] ?? { layer: 'unattributed' })
        const unsupported = []
        const pred = route ? (route.decision.action === 'CLARIFY' ? 'CLARIFY' : route.decision.contextId ?? 'ERROR') : delivery.topic_id
        return { session_id: session.session_id, i: t.i, replay: 'product-v1', routing_schema: 'routing-v1', mode, policy,
          state_ablation: stateAblation, at: t.at, pred, action: route?.decision.action ?? 'FORWARDED',
          refs: route?.decision.relatedIds ?? [], ...(route ? { decision: route.decision } : {}),
          ...(receipt?.errorCode ? { error: receipt.errorCode } : {}),
          trace: receipt?.trace ?? null, call_details: receipt?.callDetails ?? [], receipt_missing: !receipt?.trace,
          tier: receipt ? receipt.tier === 'rules' && !receipt.calls ? 'fast' : receipt.tier : 'unattributed',
          via: receipt?.mode ?? 'native-delivery', calls: calls.length, logical_calls: receipt?.calls ?? null,
          usage_by_call: calls, usage: calls.reduce((a, c) => ({ input: a.input + (c.input ?? 0), output: a.output + (c.output ?? 0),
            cache_hit: a.cache_hit + (c.cache_hit ?? 0) }), { input: 0, output: 0, cache_hit: 0 }),
          latency_ms: calls.reduce((n, c) => n + (c.latency_ms ?? 0), 0), elapsed_ms: Math.round(performance.now() - started),
          events: eventResults, binding: { requested: t.input ?? {}, applied: receipt?.binding?.status === 'applied', resolution: receipt?.binding ?? null,
            unsupported, ablated: stateAblation === 'drop-bindings' },
          state_before: stateBefore, state_after: after, snapshot_phase: steered ? 'after-shared-round' : 'after-turn',
          ...extra }
      }
      rows.push(rowFor(turn, input, before, routeRecords ?? app.model.records, {
        ...(cards ? { card_usage: transportCalls(app.model.cardRecords, () => ({ layer: 'card' })) } : {}),
        auxiliary_usage: [...eventUsage, ...transportCalls(app.model.auxiliaryRecords, () => ({ layer: 'terms' }))],
      }))
      if (steered) {
        // Independently check delivery against the Worker input, in addition to
        // the persisted binding receipt. Neither observation reads gold.
        const observed = app.model.workerInputs.slice(workerCount).filter(w => w.messages.at(-1)?.text === steered.text)
        const destinations = [...new Set(observed.map(w => app.ctx.theone.store.contexts().find(t => t.workingSessionId === w.sessionId)?.id).filter(Boolean))]
        rows.push(rowFor(steered, steerInput, steerBefore, app.model.records, {
          events: [], delivery: { kind: 'steering', observed: destinations.length === 1, topic_id: destinations[0] ?? null },
        }))
        position++
      }
    }
    validatePredictionKeys([session], rows)
    return rows
  } finally {
    try { if (app) await closeEventRuntime(app) }
    finally { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) }
  }
}
