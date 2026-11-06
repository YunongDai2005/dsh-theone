/** Metadata-only protocol. No runtime imports, message bodies or tool arguments. Times are epoch ms. */
export interface BubbleScope { gatewayKey: string; gatewayId: string | null }
export interface BubbleCursor { epoch: string; version: number; seq: number }
export type TopicLifecycle = 'active' | 'waiting' | 'dormant' | 'done'
export type WorkPhase = 'routing' | 'queued' | 'starting' | 'running' | 'waiting_user' | 'recovering'
  | 'succeeded' | 'failed' | 'stopped' | 'interrupted' | 'superseded' | 'unknown'
export type DeliveryPhase = 'waiting' | 'selected' | 'showing' | 'shown' | 'discarded' | 'unknown'
export type QueueReason = 'host_queue' | 'capacity' | 'topic_busy' | 'project_busy' | 'handoff'
export interface Capability {
  allowed: boolean
  reason?: 'gateway_busy' | 'topic_busy' | 'unavailable' | 'pending_delivery' | 'unsupported' | 'already_delivered' | 'already_stopped' | 'not_running'
}
export interface BubbleTopic {
  id: string; title: string; label: string | null; openSessionId: string
  /** Reserved for structural preconditions; not implemented in phase one. */
  topicRevision: number | null
  current: boolean; lifecycle: TopicLifecycle; declaredDoneAt: number | null; effectiveDone: boolean
  archived: boolean; private: boolean; groupId: string | null
  project: { id: string; name: string } | null
  usage: { completedCalls: number; recentCalls: number; lastUsedAt: number | null }
  lastActivityAt: number | null; workItemIds: string[]
  capabilities: { mount: Capability; declareDone: Capability; mergeNow: Capability; queueMerge: Capability; delete: Capability }
}
export interface BubbleWorkItem {
  id: string; gatewayId: string; primaryMessageId: string; messageIds: string[]; batchId: string | null
  source: 'user' | 'steering' | 'goal' | 'relay' | 'unknown'
  contextId: string | null; targetUnavailable?: boolean; executionId: string | null
  lane: 'foreground' | 'background' | null; phase: WorkPhase; queueReason?: QueueReason
  waits?: { kind: 'question' | 'approval'; referenceId: string; ownerSessionId: string; callId?: string }[]
  delivery: { phase: DeliveryPhase; shownSteps: number; committedSteps: number; commit: { sessionId: string; eventSeq: number } | null }
  temporary?: { kind: 'model_aside' | 'arithmetic'; returnContextId: string | null }
  outcome?: 'completed' | 'failed' | 'stopped' | 'interrupted' | 'moved'
  updatedAt: number; stop: Capability
}
export interface InboxItem { messageId: string; workItemId: string | null; contextId: string | null; position: number }
export interface BubbleGateway {
  id: string; currentId: string | null; showingExecutionId: string | null
  nextTurn: InboxItem[]; nextStep: InboxItem[]; claimed: { batchId: string; messageIds: string[] }[]
}
export interface BubbleEdge {
  a: string; b: string; relation: 'related' | 'kept_apart'; strength: number; manual: -1 | 0 | 1
  reasons: ('manual' | 'workspace' | 'project' | 'entities' | 'learned')[]
}
export interface BubbleMerge {
  operationId: string; requestId: string; sourceId: string; targetId: string; whenIdle: boolean
  suggestionId?: string
  state: 'queued' | 'executing' | 'succeeded' | 'cancelled' | 'expired' | 'failed'
  createdAt: number; updatedAt: number; expiresAt: number; error?: string
}
export interface BubbleMergeSuggestion {
  suggestionId: string; scope: BubbleScope; pair: [string, string]
  /** Source is removed; target retains its identity. The first direction is the default. */
  directions: [{ sourceId: string; targetId: string }, { sourceId: string; targetId: string }]
  evidence: { sharedNames: number; titleSimilarity: number }
  createdAt: number; updatedAt: number; expiresAt: number
  state: 'pending' | 'accepted' | 'declined' | 'dismissed' | 'expired'
  operationId?: string; sourceId?: string; targetId?: string; requestId?: string; reason?: string
}
export interface BubbleView {
  scope: BubbleScope; topics: BubbleTopic[]; workItems: BubbleWorkItem[]; gateway: BubbleGateway | null; edges: BubbleEdge[]
  merges: BubbleMerge[]
  /** Always supplied by current servers; optional for older schemaVersion 1 producers. */
  mergeReceipts?: BubbleMerge[]
  mergeSuggestions?: BubbleMergeSuggestion[]
  health: { catalog: 'ready' | 'indexing' | 'unavailable' | 'consent_required' | 'unknown'; router: 'ready' | 'rules' | 'unavailable' | 'unknown' }
}
export interface BubbleSnapshot extends BubbleView {
  schemaVersion: 1; cursor: BubbleCursor; eventFloor: number; serverTime: number
}
export type BubbleEventData =
  | ({ type: 'merge.changed' } & BubbleMerge)
  | { type: 'mergeSuggestion.appeared'; suggestion: BubbleMergeSuggestion }
  | { type: 'mergeSuggestion.ended'; suggestionId: string; state: Exclude<BubbleMergeSuggestion['state'], 'pending'>; operationId?: string; reason?: string }
  | { type: 'route.assigned'; workItemId: string; messageIds: string[]; contextId: string; action: 'KEEP' | 'MOUNT' | 'SWAP' | 'CREATE'; created: boolean; relatedProposedIds: string[]; alternateIds: string[]; temporary?: BubbleWorkItem['temporary'] }
  | { type: 'route.blocked'; workItemId: string; reason: 'model_missing' | 'correction_unclear' | 'unknown'; candidateIds: string[] }
  | { type: 'work.changed'; workItemId: string; executionId: string | null; phase: WorkPhase; queueReason?: QueueReason }
  | { type: 'delivery.changed'; workItemId: string; executionId: string | null; phase: DeliveryPhase }
  | { type: 'route.moved'; messageId: string; fromId: string; toId: string; cause: 'explicit' | 'spoken_correction' | 'handback' | 'undo'; reexecute: boolean }
  | { type: 'route.hint'; messageId: string; suggestedId: string }
  | { type: 'topic.changed'; contextId: string; change: 'created' | 'mounted' | 'declared_done' | 'reopened' | 'archived' | 'restored' | 'removed' | 'edited' }
  | { type: 'topic.merged' | 'topic.unmerged'; sourceId: string; targetId: string }
export type BubbleEvent = BubbleEventData & { seq: number; version: number; at: number; gatewayId: string | null }
export interface BubbleReadQuery {
  gatewayId?: string; gatewayKey?: string; epoch?: string; since?: number; after?: number; waitMs?: number
}
export type BubbleReadResponse =
  | { kind: 'update'; reset: boolean; resetReason?: 'initial' | 'epoch_changed' | 'scope_changed' | 'events_expired' | 'cursor_ahead'; snapshot: BubbleSnapshot; events: BubbleEvent[] }
  | { kind: 'unchanged'; scope: BubbleScope; cursor: BubbleCursor; serverTime: number }
