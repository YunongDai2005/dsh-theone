/**
 * Keeps one messaging-app account receiving: the polling loop, and staying online across network
 * failures, refused credentials and restarts. Each app supplies a `LinkSource` (how to poll it);
 * this knows nothing of DSH, and messages go to `deliver`.
 */

/** What every app saves between runs; each adds its own credentials. These never leave the host. */
export interface LinkSaved {
  /** Receiving is on (the user can pause it without logging out). */
  enabled: boolean
  /** The app's position in its message stream, so a restart neither loses nor repeats messages. */
  cursor: string
  /** The credentials stopped working: the user has to sign in again. */
  expired?: boolean
  /** Ids of the last messages delivered, so a replayed round is not delivered twice. */
  seen?: string[]
}

/** One message from the account's owner. */
export interface LinkMessage { id: string; text: string }

export type PollResult<S> =
  | { kind: 'ok'; messages: LinkMessage[]; cursor: string; patch?: Partial<S>; nextTimeoutMs?: number }
  /** Credentials refused, perhaps for a while: wait an hour; a second refusal in a row means sign in again. */
  | { kind: 'stale' }
  /** Credentials refused for good. */
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

export interface LinkSource<S extends LinkSaved> {
  /** What changes when the user signs in again; a loop for other credentials stops. */
  identity(saved: S): string
  /** How the user recognises the account; never a secret. */
  label(saved: S): string
  /** One round: new messages from the owner only (the source filters out everyone else). */
  poll(saved: S, timeoutMs: number, signal: AbortSignal): Promise<PollResult<S>>
  /** How long one round may wait for messages (long polling). */
  timeoutMs: number
  /** Pause between rounds, for sources that do not hold the request open. */
  intervalMs?: number
  /** Tell the app receiving starts or stops; best effort. */
  started?(saved: S): Promise<void>
  stopped?(saved: S): Promise<void>
}

export interface LinkStatus {
  state: 'off' | 'online' | 'paused' | 'expired' | 'connecting'
  account?: string
  pausedUntil?: number
  lastError?: string
  lastMessageAt?: number
}

export interface RemoteLinkDeps<S extends LinkSaved> {
  source: LinkSource<S>
  load(): S | undefined
  save(saved: S | undefined): void
  /** Hand one message from the owner to main chat; resolves once it is accepted. */
  deliver(message: LinkMessage): Promise<void>
  /** The credentials stopped working for good. */
  expired?(): void
  sleep?(ms: number, signal: AbortSignal): Promise<void>
  now?(): number
  random?(): number
  log?(message: string): void
}

const RETRY_MS = 2_000
const MAX_BACKOFF_MS = 60_000
const STALE_PAUSE_MS = 60 * 60_000
const SEEN_KEPT = 200

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Exponential delay after `failures` consecutive failures, capped, with ±20% jitter. */
export function backoff(failures: number, random = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, RETRY_MS * 2 ** Math.max(0, failures - 1))
  return Math.round(base * (0.8 + random() * 0.4))
}

export class RemoteLink<S extends LinkSaved> {
  private loop?: AbortController
  private pausedUntil?: number
  protected lastError?: string
  private lastMessageAt?: number
  /** Advances on every poll; the watchdog restarts a loop that stops advancing. */
  private beat = 0
  private lastBeat = { beat: -1, at: 0 }
  private watchdog?: ReturnType<typeof setInterval>
  protected readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  private readonly now: () => number
  private readonly random: () => number

  constructor(protected readonly deps: RemoteLinkDeps<S>) {
    this.sleep = deps.sleep ?? abortableSleep
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
  }

  status(): LinkStatus {
    const saved = this.deps.load()
    const state = !saved ? 'off' : saved.expired ? 'expired' : !saved.enabled ? 'off'
      : this.pausedUntil !== undefined && this.pausedUntil > this.now() ? 'paused' : this.loop ? 'online' : 'connecting'
    return { state, ...(saved ? { account: this.deps.source.label(saved) } : {}),
      ...(state === 'paused' ? { pausedUntil: this.pausedUntil } : {}), ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.lastMessageAt ? { lastMessageAt: this.lastMessageAt } : {}) }
  }

  /** The saved account, unless it expired: what replies are sent with. */
  current(): S | undefined {
    const saved = this.deps.load()
    return saved && !saved.expired ? saved : undefined
  }

  /** Start receiving if an account is bound and receiving is on (TheOne starting, or the user resuming). */
  start(): void {
    const saved = this.deps.load()
    if (!saved || !saved.enabled || saved.expired || this.loop) return
    this.run(saved)
    this.watchdog ??= setInterval(() => this.checkBeat(), 60_000)
    this.watchdog.unref?.()
  }

  /** Stop receiving (pausing, logging out, TheOne stopping); the app is told, best effort. */
  async stop(): Promise<void> {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = undefined }
    const loop = this.loop
    this.loop = undefined
    if (!loop) return
    loop.abort()
    const saved = this.deps.load()
    if (saved) await this.deps.source.stopped?.(saved).catch(() => {})
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const saved = this.deps.load()
    if (!saved) return
    this.deps.save({ ...saved, enabled })
    if (enabled) this.start()
    else await this.stop()
  }

  /** Bind new credentials (after a login) and start receiving with them. */
  async bind(saved: S): Promise<void> {
    await this.stop()
    this.deps.save(saved)
    this.pausedUntil = undefined
    this.lastError = undefined
    this.start()
  }

  async logout(): Promise<void> {
    await this.stop()
    this.deps.save(undefined)
    this.pausedUntil = undefined
    this.lastError = undefined
  }

  private run(saved: S): void {
    const loop = new AbortController()
    this.loop = loop
    void this.poll(saved, loop.signal).catch(error => {
      if (!loop.signal.aborted) this.lastError = error instanceof Error ? error.message : String(error)
    }).finally(() => {
      if (this.loop !== loop) return
      this.loop = undefined
      // An unexpected exit: come back after a pause rather than stay offline.
      if (!loop.signal.aborted) setTimeout(() => this.start(), backoff(3, this.random)).unref?.()
    })
  }

  private async poll(first: S, signal: AbortSignal): Promise<void> {
    const { source } = this.deps
    const identity = source.identity(first)
    await source.started?.(first).catch(() => {})
    let timeoutMs = source.timeoutMs
    let failures = 0
    let staleBefore = false
    while (!signal.aborted) {
      this.beat++
      if (this.pausedUntil !== undefined) {
        const wait = this.pausedUntil - this.now()
        if (wait > 0) { await this.sleep(wait, signal); continue }
      }
      const saved = this.deps.load()
      if (!saved || !saved.enabled || saved.expired || source.identity(saved) !== identity) return
      const result = await source.poll(saved, timeoutMs, signal)
      if (signal.aborted) return
      if (result.kind === 'expired' || (result.kind === 'stale' && staleBefore)) {
        this.deps.save({ ...saved, expired: true })
        this.pausedUntil = undefined
        this.lastError = 'TOKEN_EXPIRED'
        this.deps.log?.('A messaging app\'s login expired; the user has to sign in again.')
        this.deps.expired?.()
        this.loop = undefined
        return
      }
      if (result.kind === 'stale') {
        // The first refusal may be temporary: wait an hour.
        staleBefore = true
        this.pausedUntil = this.now() + STALE_PAUSE_MS
        this.lastError = 'TOKEN_STALE'
        continue
      }
      if (result.kind === 'error') {
        failures++
        this.lastError = result.message
        await this.sleep(backoff(failures, this.random), signal)
        continue
      }
      failures = 0
      staleBefore = false
      this.pausedUntil = undefined
      this.lastError = undefined
      if (result.nextTimeoutMs) timeoutMs = result.nextTimeoutMs
      // Credentials the round learned (a conversation token, a newly paired owner) apply to this round's replies.
      if (result.patch) this.deps.save({ ...saved, ...result.patch })
      const seen = new Set(saved.seen ?? [])
      for (const message of result.messages) {
        if (seen.has(message.id)) continue
        seen.add(message.id)
        if (!message.text) continue
        this.lastMessageAt = this.now()
        await this.deps.deliver(message)
        if (signal.aborted) return
      }
      // Saved after delivery: a crash in between repeats the round, and `seen` drops the repeats.
      const current = this.deps.load()
      if (!current || source.identity(current) !== identity) return
      this.deps.save({ ...current, cursor: result.cursor, seen: [...seen].slice(-SEEN_KEPT) })
      if (source.intervalMs) await this.sleep(source.intervalMs, signal)
    }
  }

  /** The loop has not polled for several rounds: it is stuck, so start it again. */
  private checkBeat(): void {
    if (!this.loop || (this.pausedUntil ?? 0) > this.now()) { this.lastBeat = { beat: this.beat, at: this.now() }; return }
    if (this.beat !== this.lastBeat.beat) { this.lastBeat = { beat: this.beat, at: this.now() }; return }
    if (this.now() - this.lastBeat.at < 3 * (this.deps.source.timeoutMs + (this.deps.source.intervalMs ?? 0) + 5000)) return
    this.deps.log?.('A messaging app\'s loop stalled; restarting it.')
    const loop = this.loop
    this.loop = undefined
    loop.abort()
    this.start()
  }
}
