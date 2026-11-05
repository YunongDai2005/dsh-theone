import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Decision } from './types.ts'
import type { WorkerRun } from './run.ts'
import type { BubbleEventData, BubbleGateway, BubbleWorkItem, QueueReason } from './bubble-types.ts'

/** Observations only: never schedules, cancels, routes or writes to a session. */
export class BubbleActivity {
  private readonly items = new Map<string, BubbleWorkItem>()
  private readonly claimed = new Map<string, { batchId: string; messageIds: string[] }>()
  private readonly listeners = new Set<(events: BubbleEventData[], gatewayId: string | null) => void>()
  subscribe(listener: (events: BubbleEventData[], gatewayId: string | null) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener) }
  }
  publish(events: BubbleEventData[] = [], gatewayId: string | null = null): void {
    for (const listener of this.listeners) { try { listener(events, gatewayId) } catch { /* Observation cannot interrupt execution. */ } }
  }
  snapshot(): BubbleWorkItem[] { return structuredClone([...this.items.values()]) }
  private find(gatewayId: string, messageId: string): BubbleWorkItem | undefined {
    return [...this.items.values()].findLast(item => item.gatewayId === gatewayId && item.messageIds.includes(messageId) && item.phase !== 'superseded')
  }
  input(agent: Agent, message: UserMessage): BubbleWorkItem {
    const found = this.find(agent.id, message.id)
    if (found) return found
    const item: BubbleWorkItem = { id: randomUUID(), gatewayId: agent.id, primaryMessageId: message.id,
      messageIds: [message.id], batchId: randomUUID(), source: message.source.kind === 'user' ? 'user' : (message.source.kind as string) === 'goal' ? 'goal' : 'relay',
      contextId: null, executionId: null, lane: null, phase: 'queued', queueReason: 'host_queue',
      delivery: { phase: 'waiting', shownSteps: 0, committedSteps: 0, commit: null }, updatedAt: Date.now(), stop: { allowed: false, reason: 'unsupported' } }
    this.items.set(item.id, item); this.changed(item); this.prune(); return item
  }
  claim(agent: Agent, message: UserMessage): void {
    const item = this.input(agent, message)
    let batch = this.claimed.get(agent.id)
    if (!batch) this.claimed.set(agent.id, batch = { batchId: randomUUID(), messageIds: [] })
    if (!batch.messageIds.includes(message.id)) batch.messageIds.push(message.id)
    item.batchId = batch.batchId
    if (!item.executionId) { item.phase = 'routing'; delete item.queueReason }
    this.changed(item)
  }
  batch(agent: Agent, messages: UserMessage[]): void {
    if (!messages.length) return
    const target = this.input(agent, messages.at(-1)!), ids: string[] = messages.map(message => message.id)
    for (const item of this.items.values()) if (item !== target && !item.executionId && item.gatewayId === agent.id && item.messageIds.some(id => ids.includes(id))) this.items.delete(item.id)
    target.messageIds = [...new Set([...target.messageIds, ...ids])]
    this.changed(target)
  }
  releaseClaim(gatewayId: string, messageIds?: string[]): void {
    const batch = this.claimed.get(gatewayId)
    if (!batch) return
    batch.messageIds = messageIds ? batch.messageIds.filter(id => !messageIds.includes(id)) : []
    if (!batch.messageIds.length) this.claimed.delete(gatewayId)
    this.publish([], gatewayId)
  }
  routing(agent: Agent, message: UserMessage): void {
    const item = this.input(agent, message)
    if (!item.executionId) { item.phase = 'routing'; delete item.queueReason; this.changed(item) }
  }
  assign(agent: Agent, message: UserMessage, decision: Decision, temporary?: BubbleWorkItem['temporary']): void {
    const item = this.input(agent, message)
    const changed = item.contextId !== (decision.contextId ?? null)
    item.contextId = decision.contextId ?? null; item.temporary = temporary
    const events: BubbleEventData[] = []
    if (decision.action !== 'CLARIFY' && decision.contextId && changed) events.push({ type: 'route.assigned', workItemId: item.id,
      messageIds: [...item.messageIds], contextId: decision.contextId, action: decision.action, created: decision.action === 'CREATE',
      relatedProposedIds: decision.relatedIds ?? [], alternateIds: decision.alternateIds ?? [], ...(temporary ? { temporary } : {}) })
    if (decision.action === 'CLARIFY') {
      item.phase = 'waiting_user'
      events.push({ type: 'route.blocked', workItemId: item.id, reason: decision.reason === 'ROUTER_MODEL_MISSING' ? 'model_missing' : decision.reason === 'correction-unclear' ? 'correction_unclear' : 'unknown', candidateIds: decision.relatedIds ?? [] })
    }
    item.updatedAt = Date.now(); this.publish(events, agent.id)
  }
  queue(agent: Agent, message: UserMessage, reason: QueueReason, contextId?: string): void {
    const item = this.input(agent, message)
    if (item.executionId) return
    item.contextId = contextId ?? item.contextId; item.phase = 'queued'; item.queueReason = reason; this.changed(item)
  }
  starting(agent: Agent, message: UserMessage, contextId: string, waitingProject = false): void {
    const item = this.input(agent, message)
    item.contextId = contextId; item.phase = waitingProject ? 'queued' : 'starting'
    if (waitingProject) item.queueReason = 'project_busy'; else delete item.queueReason
    this.changed(item)
  }
  register(run: WorkerRun, contextId: string, lane: 'foreground' | 'background'): void {
    let item = this.find(run.gateway.id, run.inputId)
    if (item?.executionId && item.executionId !== run.executionId) {
      item.phase = 'superseded'; item.outcome = 'moved'; item.delivery.phase = 'discarded'; this.changed(item)
      item = { ...structuredClone(item), id: randomUUID(), executionId: null, phase: 'starting', outcome: undefined,
        delivery: { phase: 'waiting', shownSteps: 0, committedSteps: 0, commit: null } }
      this.items.set(item.id, item)
    }
    if (!item) return
    item.contextId = contextId; item.executionId = run.executionId; item.lane = lane
    run.observe = () => this.observe(run)
    this.observe(run)
  }
  restore(run: WorkerRun): void {
    const original = [...this.items.values()].find(item => item.executionId === run.executionId)
    if (!original) return
    for (const item of this.items.values()) if (item !== original && item.gatewayId === run.gateway.id && item.primaryMessageId === run.inputId && item.phase !== 'superseded') {
      item.phase = 'stopped'; item.outcome = 'stopped'; item.delivery.phase = 'discarded'; this.changed(item)
    }
    // The old run itself was never superseded; only the tentative handoff observation was.
    original.phase = 'unknown'; delete original.outcome; this.observe(run)
  }
  observe(run: WorkerRun): void {
    const item = [...this.items.values()].find(item => item.executionId === run.executionId)
    if (!item || item.phase === 'superseded') return
    const before = JSON.stringify([item.phase, item.delivery, item.messageIds])
    const deliveryBefore = item.delivery.phase
    if (['selected', 'showing', 'shown'].includes(run.delivery.phase)) item.lane = 'foreground'
    item.phase = run.observedPhase; item.delivery = structuredClone(run.delivery)
    item.messageIds = [...new Set([...item.messageIds, ...run.forwarded.keys()])]
    if (item.phase !== 'starting') delete item.queueReason
    if (run.done) item.outcome = run.failure ? 'failed' : item.phase === 'stopped' ? 'stopped' : run.outcome?.kind === 'completed' ? 'completed' : 'failed'
    if (before === JSON.stringify([item.phase, item.delivery, item.messageIds])) return
    item.updatedAt = Date.now()
    const events: BubbleEventData[] = [{ type: 'work.changed', workItemId: item.id, executionId: item.executionId, phase: item.phase }]
    if (deliveryBefore !== item.delivery.phase) events.push({ type: 'delivery.changed', workItemId: item.id, executionId: item.executionId, phase: item.delivery.phase })
    this.publish(events, item.gatewayId); this.prune()
  }
  forward(run: WorkerRun, message: UserMessage): void {
    const separate = this.find(run.gateway.id, message.id)
    if (separate && separate.executionId !== run.executionId) this.items.delete(separate.id)
    this.releaseClaim(run.gateway.id, [message.id]); this.observe(run); this.publish([], run.gateway.id)
  }
  discard(gatewayId: string, messageId: string): void {
    const item = this.find(gatewayId, messageId)
    if (item) {
      if (item.executionId && item.primaryMessageId !== messageId) item.messageIds = item.messageIds.filter(id => id !== messageId)
      else { item.delivery.phase = 'discarded'; if (!item.executionId) item.phase = 'stopped' }
      this.changed(item)
    }
    this.releaseClaim(gatewayId, [messageId])
  }
  standalone(agent: Agent, message: UserMessage, phase: BubbleWorkItem['phase']): void {
    const item = this.input(agent, message)
    item.phase = phase; item.delivery.phase = 'showing'; item.delivery.shownSteps = 1
    this.changed(item)
  }
  commitStandalone(gatewayId: string, eventSeq: number): void {
    const item = [...this.items.values()].findLast(item => item.gatewayId === gatewayId && !item.executionId && item.delivery.phase === 'showing')
    if (!item || item.delivery.commit?.eventSeq === eventSeq) return
    item.delivery.committedSteps++; item.delivery.commit = { sessionId: gatewayId, eventSeq }; this.changed(item)
  }
  endTurn(gatewayId: string, completed: boolean): void {
    const claimed = this.claimed.get(gatewayId)?.messageIds ?? []
    for (const item of this.items.values()) if (item.gatewayId === gatewayId && !item.executionId &&
      (item.delivery.phase === 'showing' || item.messageIds.some(id => claimed.includes(id)))) {
      item.delivery.phase = completed && item.delivery.committedSteps > 0 ? 'shown' : 'discarded'
      if (item.phase === 'routing') item.phase = 'failed'
      this.changed(item)
    }
    this.releaseClaim(gatewayId); this.publish([], gatewayId)
  }
  failed(agent: Agent, message: UserMessage): void {
    const item = this.input(agent, message); item.phase = 'failed'; item.outcome = 'failed'; this.changed(item)
  }
  gateway(agent: Agent, currentId: string | null): BubbleGateway {
    const inbox = (messages: readonly UserMessage[]) => messages.map((message, position) => {
      const item = this.find(agent.id, message.id)
      return { messageId: message.id, workItemId: item?.id ?? null, contextId: item?.contextId ?? null, position }
    })
    return { id: agent.id, currentId,
      showingExecutionId: [...this.items.values()].findLast(item => item.gatewayId === agent.id && ['selected', 'showing'].includes(item.delivery.phase))?.executionId ?? null,
      nextTurn: inbox(agent.inbox.nextTurn), nextStep: inbox(agent.inbox.nextStep),
      claimed: this.claimed.has(agent.id) ? [structuredClone(this.claimed.get(agent.id)!)] : [] }
  }
  private changed(item: BubbleWorkItem): void {
    item.updatedAt = Date.now()
    this.publish([{ type: 'work.changed', workItemId: item.id, executionId: item.executionId, phase: item.phase, ...(item.queueReason ? { queueReason: item.queueReason } : {}) }], item.gatewayId)
  }
  private prune(): void {
    const settled = [...this.items.values()].filter(item => ['shown', 'discarded'].includes(item.delivery.phase) && ['succeeded', 'failed', 'stopped', 'superseded'].includes(item.phase))
    for (const item of settled.slice(0, Math.max(0, settled.length - 128))) this.items.delete(item.id)
  }
}
