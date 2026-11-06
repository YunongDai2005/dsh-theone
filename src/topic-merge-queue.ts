import { randomUUID } from 'node:crypto'
import { openDatabase } from './sqlite.ts'
import type { BubbleMerge } from './bubble-types.ts'

interface MergeHooks {
  validate(sourceId: string, targetId: string): void
  busy(): boolean
  execute(operation: BubbleMerge, eligible: () => boolean): Promise<void>
  committed(operation: BubbleMerge): boolean
  changed(operation: BubbleMerge): void
}
const pending = (op: BubbleMerge) => op.state === 'queued' || op.state === 'executing'

/** Explicit user commands only. Reads never drain, expire or persist the queue. */
export class TopicMergeQueue {
  private readonly db
  private readonly operations = new Map<string, BubbleMerge>()
  private readonly tasks = new Set<Promise<void>>()
  private timer?: ReturnType<typeof setInterval>
  private closed = false
  constructor(path: string, private readonly hooks: MergeHooks, private readonly now = Date.now, private readonly ttlMs = 300000) {
    this.db = openDatabase(path, 5000)
    this.db.exec('CREATE TABLE IF NOT EXISTS merge_operations (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, receipt TEXT NOT NULL)')
    for (const row of this.db.prepare('SELECT receipt FROM merge_operations ORDER BY rowid').all()) {
      const op = JSON.parse(String(row.receipt)) as BubbleMerge
      this.operations.set(op.operationId, op)
      if (pending(op)) {
        if (op.state === 'executing' && hooks.committed(op)) this.change(op, 'succeeded')
        else this.change(op, 'cancelled', 'MERGE_RESTARTED')
      }
    }
  }
  start(): void {
    this.timer = setInterval(() => { void this.drain().catch(error => console.warn('TheOne merge queue failed.', error)) }, 100)
    this.timer.unref()
  }
  active(): BubbleMerge[] { return structuredClone([...this.operations.values()].filter(pending)) }
  receipts(): BubbleMerge[] { return structuredClone([...this.operations.values()]) }
  receipt(operationId: string): BubbleMerge | undefined {
    const op = this.operations.get(operationId)
    return op && structuredClone(op)
  }
  conflicts(sourceId: string, targetId: string, except?: string): boolean {
    return [...this.operations.values()].some(op => pending(op) && op.operationId !== except &&
      [op.sourceId, op.targetId].some(id => id === sourceId || id === targetId))
  }
  async request(sourceId: string, targetId: string, requestId: string, whenIdle: boolean, suggestionId?: string): Promise<BubbleMerge> {
    if (this.closed) throw new Error('MERGE_UNAVAILABLE')
    const previous = [...this.operations.values()].find(op => op.requestId === requestId)
    if (previous) {
      if (previous.sourceId !== sourceId || previous.targetId !== targetId || previous.whenIdle !== whenIdle || previous.suggestionId !== suggestionId) throw new Error('REQUEST_ID_CONFLICT')
      return structuredClone(previous)
    }
    this.hooks.validate(sourceId, targetId)
    if (this.conflicts(sourceId, targetId)) throw new Error('MERGE_CONFLICT')
    if (!whenIdle && this.hooks.busy()) throw new Error('GATEWAY_BUSY')
    const at = this.now()
    const op: BubbleMerge = { operationId: randomUUID(), requestId, sourceId, targetId, whenIdle,
      state: 'queued', createdAt: at, updatedAt: at, expiresAt: at + this.ttlMs, ...(suggestionId ? { suggestionId } : {}) }
    this.operations.set(op.operationId, op)
    this.change(op, 'queued')
    await this.attempt(op)
    return structuredClone(op)
  }
  cancel(operationId: string, reason = 'MERGE_CANCELLED'): BubbleMerge {
    const op = this.operations.get(operationId)
    if (!op) throw new Error('UNKNOWN_MERGE')
    if (op.state === 'cancelled') return structuredClone(op)
    if (op.state === 'executing') throw new Error('MERGE_EXECUTING')
    if (op.state !== 'queued') throw new Error('MERGE_FINISHED')
    this.change(op, 'cancelled', reason)
    return structuredClone(op)
  }
  async drain(): Promise<void> {
    if (this.closed) return
    for (const op of this.operations.values()) if (op.state === 'queued') await this.attempt(op)
  }
  private attempt(op: BubbleMerge): Promise<void> {
    if (this.closed || op.state !== 'queued') return Promise.resolve()
    if (this.now() >= op.expiresAt) { this.change(op, 'expired', 'MERGE_EXPIRED'); return Promise.resolve() }
    if (this.hooks.busy()) return Promise.resolve()
    this.change(op, 'executing')
    const task = this.execute(op)
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task)).catch(() => {})
    return task
  }
  private async execute(op: BubbleMerge): Promise<void> {
    try {
      this.hooks.validate(op.sourceId, op.targetId)
      await this.hooks.execute(op, () => !this.closed && this.now() < op.expiresAt)
      this.change(op, 'succeeded')
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'MERGE_FAILED'
      if (this.closed) this.change(op, 'cancelled', 'MERGE_RESTARTED')
      else if (this.now() >= op.expiresAt) this.change(op, 'expired', 'MERGE_EXPIRED')
      else if (code === 'GATEWAY_BUSY' && op.whenIdle) this.change(op, 'queued')
      else this.change(op, 'failed', code)
    }
  }
  private change(op: BubbleMerge, state: BubbleMerge['state'], error?: string): void {
    op.state = state; op.updatedAt = this.now()
    if (error) op.error = error; else delete op.error
    this.db.prepare('INSERT INTO merge_operations VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET receipt=excluded.receipt')
      .run(op.operationId, op.requestId, JSON.stringify(op))
    this.hooks.changed(structuredClone(op))
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true; clearInterval(this.timer)
    for (const op of this.operations.values()) if (op.state === 'queued') this.change(op, 'cancelled', 'MERGE_RESTARTED')
    await Promise.allSettled(this.tasks)
    this.db.close()
  }
}
