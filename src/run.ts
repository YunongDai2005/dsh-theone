import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Finish code with which the main chat redoes its attempt after the Worker retried the step being shown. */
export const RESTART_CODE = 'THEONE_WORKER_RETRY'

type FinishChunk = Extract<StreamChunk, { type: 'finish' }>
interface Attempt { readonly id: string; readonly chunks: StreamChunk[]; finish?: FinishChunk; settled?: 'committed' | 'failed' }
interface Step { readonly turn: number; readonly step: number; attempt: Attempt }

/**
 * One Worker activity mirrored into the main chat. Each Worker step is shown as one main-chat step
 * carrying the same reasoning, text and tool calls, so it reads like an ordinary conversation; the
 * main chat's tool calls then resolve with the Worker's results instead of running a second time.
 */
export class WorkerRun {
  private readonly steps: Step[] = []
  /** Main-chat steps opened for this run; step n shows Worker step n. */
  private shown = 0
  private restarting = false
  private characters = 0
  private waiters: (() => void)[] = []
  /** Worker results per call id, consumed in order: some providers reuse ids such as `call_0` every step. */
  private readonly results = new Map<string, { produced: ToolExecutionResult[]; waiting: PromiseWithResolvers<ToolExecutionResult>[] }>()
  private readonly disposers: (() => void)[] = []
  /** Main-chat steering message id → its copy in the Worker inbox. */
  readonly forwarded = new Map<string, string>()
  failure?: Error
  outcome?: TurnEndReason
  done = false
  settled: Promise<void> = Promise.resolve()

  constructor(ctx: Context, readonly worker: Agent, readonly gateway: Agent, readonly inputId: string,
    private readonly maxChars: number, private readonly beforeToolCalls: (names: string[]) => void) {
    this.disposers.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (agent.id !== worker.id) return
      if (frame.type === 'start') {
        const attempt: Attempt = { id: frame.attemptId, chunks: [] }
        // The limit applies per step: a long multi-step task is not cut off by its total length.
        this.characters = 0
        const last = this.steps.at(-1)
        // A new attempt for the same step is the Worker retrying it.
        if (last && last.turn === frame.turn && last.step === frame.step) last.attempt = attempt
        else this.steps.push({ turn: frame.turn, step: frame.step, attempt })
      } else {
        const attempt = this.steps.at(-1)?.attempt
        if (!attempt || attempt.id !== frame.attemptId) return
        if (frame.type === 'end') {
          attempt.settled = frame.outcome.kind === 'committed' && frame.outcome.eventType === 'assistant/message' ? 'committed' : 'failed'
        } else if (frame.chunk.type === 'finish') attempt.finish = frame.chunk
        else if (frame.chunk.type !== 'usage') {
          // The main chat keeps its own usage; everything the reader sees is mirrored as is.
          if (frame.chunk.type === 'text-delta' || frame.chunk.type === 'reasoning-delta') this.characters += frame.chunk.text.length
          attempt.chunks.push(frame.chunk)
          if (this.characters > this.maxChars) this.fail(new Error('Worker response exceeded maxResponseChars'))
        }
      }
      this.wake()
    }))
    this.disposers.push(ctx.on('tools/result', (exec, result) => {
      if (exec.agent?.id !== worker.id || exec.parent !== undefined) return
      const entry = this.entry(exec.callId)
      const waiting = entry.waiting.shift()
      if (waiting) waiting.resolve(result)
      else entry.produced.push(result)
    }))
    this.disposers.push(ctx.on('session/event', (session, event) => {
      if (session.id === worker.id && event.type === 'turn/end') this.outcome = event.data.reason
    }))
  }

  /** Related topics whose news this run's briefing carried, and those the Worker then looked up. */
  briefed: string[] = []
  readonly lookedUp = new Set<string>()
  /** The Worker recorded facts itself this run, so no extraction is needed afterwards. */
  recordedFacts = false

  /** The request this run answers, as the user wrote it. */
  request = ''

  /** The end of what the Worker has written so far, for judging messages sent meanwhile. */
  progress(limit = 600): string {
    let text = ''
    for (const step of [...this.steps].reverse()) {
      const written = step.attempt.chunks.map(chunk => chunk.type === 'text-delta' ? chunk.text : '').join('')
      text = written + (text && written ? '\n' : '') + text
      if (text.length >= limit) break
    }
    return text.slice(-limit)
  }

  /** Give the Worker its context and input; the run ends when the Worker is idle again. */
  start(contexts: UserMessage[], input: UserMessage): void {
    for (const context of contexts) this.worker.inject(context)
    this.worker.followup(input)
    this.settled = this.worker.whenIdle().then(() => undefined, error => {
      this.failure ??= error instanceof Error ? error : new Error(String(error))
    }).finally(() => {
      this.done = true
      for (const entry of this.results.values()) for (const { reject } of entry.waiting.splice(0)) reject(new Error('Worker did not complete this tool call'))
      this.wake()
    })
  }

  /** Steering sent to the main chat during the reply reaches the Worker at its next step. */
  get canForward(): boolean { return !this.done && this.worker.status === 'running' }
  forward(message: UserMessage): void {
    const copy = createUserMessage({ source: message.source, content: message.content })
    this.forwarded.set(message.id, copy.id)
    this.worker.steer(copy)
  }
  withdraw(messageId: string): void {
    const copy = this.forwarded.get(messageId)
    if (copy) { this.forwarded.delete(messageId); this.worker.inbox.remove(copy as UserMessage['id']) }
  }

  /** Whether the Worker has started a step the main chat has not shown. */
  get unshown(): boolean { return this.steps.length > this.shown }

  /** Resolve once the Worker is idle or has started a step the main chat has not shown yet. */
  async idleOrUnshown(): Promise<void> {
    while (!this.done && !this.unshown) await new Promise<void>(resolve => this.waiters.push(resolve))
  }

  cancel(): void { if (this.worker.status !== 'idle') this.worker.cancel({ kind: 'parent' }) }
  dispose(): void { for (const dispose of this.disposers.splice(0)) dispose() }

  /** The Worker's own outcome for one of its tool calls, shown as the main chat's result. */
  async toolResult(callId: string, signal: AbortSignal): Promise<ToolExecutionResult> {
    signal.throwIfAborted()
    const entry = this.entry(callId)
    const ready = entry.produced.shift()
    if (ready) return ready
    if (this.done) throw new Error('Worker did not complete this tool call')
    const pending = Promise.withResolvers<ToolExecutionResult>()
    entry.waiting.push(pending)
    const abort = () => { this.cancel(); void this.settled.then(() => pending.reject(signal.reason)) }
    signal.addEventListener('abort', abort, { once: true })
    try { return await pending.promise } finally { signal.removeEventListener('abort', abort) }
  }

  /** Stream the next Worker step, or the same one again after a retry, as one main-chat attempt. */
  async *stream(signal?: AbortSignal): AsyncIterable<StreamChunk> {
    const index = this.restarting ? this.shown - 1 : this.shown++
    this.restarting = false
    let attempt: Attempt | undefined
    let sent = 0
    let finished = false
    // Only a cancellation while this step is still being shown stops the Worker.
    const abort = (): void => { if (!finished) { this.cancel(); this.wake() } }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      for (;;) {
        if (signal?.aborted) {
          // The main chat's cancellation completes once the Worker has actually stopped.
          this.cancel(); await this.settled; signal.throwIfAborted()
        }
        if (this.failure) { this.cancel(); await this.settled; throw this.failure }
        const step = this.steps[index]
        if (step) {
          if (attempt && step.attempt !== attempt) {
            // DSH streams cannot retract text. Redo this main-chat attempt, as a native retry does.
            if (sent) {
              this.restarting = true
              finished = true
              yield { type: 'finish', reason: { kind: 'error', failure: { code: RESTART_CODE, message: 'The background reply was retried' } } }
              return
            }
          }
          if (step.attempt !== attempt) { attempt = step.attempt; sent = 0 }
          while (sent < attempt.chunks.length) yield attempt.chunks[sent++]
          if (attempt.settled === 'committed') {
            const calls = attempt.chunks.flatMap(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call' ? [chunk.block.name] : [])
            if (calls.length) this.beforeToolCalls([...new Set(calls)])
            finished = true
            yield attempt.finish ?? { type: 'finish', reason: { kind: calls.length ? 'tool-calls' : 'stop' } }
            return
          }
        }
        if (this.done) {
          if (this.failure) throw this.failure
          // The Worker stopped without this step: an empty step if it completed, else its failure.
          if (!step && this.outcome?.kind === 'completed') { finished = true; yield { type: 'finish', reason: { kind: 'stop' } }; return }
          throw new Error(`Worker turn did not complete: ${this.outcome?.kind ?? 'missing turn/end'}`)
        }
        await new Promise<void>(resolve => this.waiters.push(resolve))
      }
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  private fail(error: Error): void {
    this.failure ??= error
    this.cancel()
  }

  private entry(callId: string) {
    let entry = this.results.get(callId)
    if (!entry) this.results.set(callId, entry = { produced: [], waiting: [] })
    return entry
  }

  private wake(): void {
    for (const resolve of this.waiters.splice(0)) resolve()
  }
}
