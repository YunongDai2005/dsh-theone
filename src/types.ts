export interface ContextDescriptor {
  id: string
  title: string
  summary: string
  entities: string[]
  keywords: string[]
  lastState: string
}

export interface StoredContext extends ContextDescriptor {
  workingSessionId: string
}

export interface ContextUsage {
  contextId: string
  completedCalls: number
  recentCalls: number
  lastUsedAt: number
}

export type Action = 'KEEP' | 'MOUNT' | 'SWAP' | 'CREATE' | 'CLARIFY'
export interface Decision {
  action: Action
  contextId?: string
  title?: string
  reason: string
  question?: string
  /** CREATE can proceed during indexing only when the request needs no missing history. */
  historyIndependent?: boolean
}

export interface RouteRecord {
  messageId: string
  gatewayId: string
  decision: Decision
  status: 'planned' | 'running' | 'completed' | 'failed'
}

/** Inclusive raw-event ranges reviewed for a historical Context. */
export type SourceRange =
  | { sessionId: string; kind: 'bounded'; startSeq: number; endSeq: number }
  | { sessionId: string; kind: 'worker' | 'unscoped' }
