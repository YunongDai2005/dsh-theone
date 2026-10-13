/**
 * Keeps one WeChat account connected: QR login, the long-poll loop, and staying online across
 * network failures, expired tokens and restarts. Knows nothing of DSH; messages go to `deliver`.
 */
import { IlinkClient, LONG_POLL_MS, type IlinkAccount, type InboundMessage } from './weixin-ilink.ts'

/** What is saved between runs. The token never leaves the host. */
export interface WeixinSaved {
  account: IlinkAccount
  /** Receiving is on (the user can pause it without logging out). */
  enabled: boolean
  /** The server's sync cursor, so a restart neither loses nor repeats messages. */
  buf: string
  /** The latest conversation token from the user; replies carry it. */
  contextToken?: string
  /** The token was refused twice in a row: the user has to scan again. */
  expired?: boolean
  /** Ids of the last messages delivered, so a replayed round is not delivered twice. */
  seen?: string[]
}

export type LoginState =
  | { step: 'qr'; url: string }
  | { step: 'scanned' }
  | { step: 'verify' }
  | { step: 'failed'; reason: string }

export interface WeixinStatus {
  state: 'off' | 'online' | 'paused' | 'expired' | 'connecting'
  login?: LoginState
  /** Short form of the bot id, for the user to recognise; never the token. */
  account?: string
  pausedUntil?: number
  lastError?: string
  lastMessageAt?: number
}

export interface LinkDeps {
  client: IlinkClient
  load(): WeixinSaved | undefined
  save(saved: WeixinSaved | undefined): void
  /** Hand one message from the account's owner to main chat; resolves once it is accepted. */
  deliver(message: InboundMessage): Promise<void>
  /** The token stopped working for good. */
  expired?(): void
  sleep?(ms: number, signal: AbortSignal): Promise<void>
  now?(): number
  random?(): number
  log?(message: string): void
}

const RETRY_MS = 2_000
const MAX_BACKOFF_MS = 60_000
const STALE_PAUSE_MS = 60 * 60_000
const QR_REFRESHES = 3
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

export class WeixinLink {
  private loop?: AbortController
  private loginRun?: AbortController
  private login?: LoginState
  private verifyCode?: string
  private pausedUntil?: number
  private lastError?: string
  private lastMessageAt?: number
  /** Advances on every poll; the watchdog restarts a loop that stops advancing. */
  private beat = 0
  private watchdog?: ReturnType<typeof setInterval>
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  private readonly now: () => number
  private readonly random: () => number

  constructor(private readonly deps: LinkDeps) {
    this.sleep = deps.sleep ?? abortableSleep
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
  }

  status(): WeixinStatus {
    const saved = this.deps.load()
    const state = !saved ? 'off' : saved.expired ? 'expired' : !saved.enabled ? 'off'
      : this.pausedUntil !== undefined && this.pausedUntil > this.now() ? 'paused' : this.loop ? 'online' : 'connecting'
    return { state, ...(this.login ? { login: this.login } : {}), ...(saved ? { account: saved.account.botId.slice(0, 8) } : {}),
      ...(state === 'paused' ? { pausedUntil: this.pausedUntil } : {}), ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.lastMessageAt ? { lastMessageAt: this.lastMessageAt } : {}) }
  }

  /** The bound account, for replies. */
  account(): IlinkAccount | undefined {
    const saved = this.deps.load()
    return saved && !saved.expired ? saved.account : undefined
  }

  contextToken(): string | undefined {
    return this.deps.load()?.contextToken
  }

  /** Start receiving if an account is bound and receiving is on (TheOne starting, or the user resuming). */
  start(): void {
    const saved = this.deps.load()
    if (!saved || !saved.enabled || saved.expired || this.loop) return
    this.run(saved.account)
    this.watchdog ??= setInterval(() => this.checkBeat(), 60_000)
    this.watchdog.unref?.()
  }

  /** Stop receiving (pausing, logging out, TheOne stopping); the server is told, best effort. */
  async stop(): Promise<void> {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = undefined }
    const loop = this.loop
    this.loop = undefined
    if (!loop) return
    loop.abort()
    const account = this.deps.load()?.account
    if (account) await this.deps.client.notify(account, 'stop').catch(() => {})
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const saved = this.deps.load()
    if (!saved) return
    this.deps.save({ ...saved, enabled })
    if (enabled) this.start()
    else await this.stop()
  }

  async logout(): Promise<void> {
    this.cancelLogin()
    await this.stop()
    this.deps.save(undefined)
    this.pausedUntil = undefined
    this.lastError = undefined
  }

  /** Begin a QR login; progress is read from `status().login`. */
  async beginLogin(): Promise<LoginState> {
    this.cancelLogin()
    const run = new AbortController()
    this.loginRun = run
    try {
      const code = await this.deps.client.qrcode(run.signal)
      this.login = { step: 'qr', url: code.url }
      void this.followLogin(code.qrcode, run).catch(error => {
        if (!run.signal.aborted) this.login = { step: 'failed', reason: error instanceof Error ? error.message : String(error) }
      }).finally(() => { if (this.loginRun === run) this.loginRun = undefined })
      return this.login
    } catch (error) {
      if (this.loginRun === run) this.loginRun = undefined
      this.login = { step: 'failed', reason: error instanceof Error ? error.message : String(error) }
      return this.login
    }
  }

  /** The code WeChat showed on the phone, when it asks for one. */
  verify(code: string): void {
    if (this.login?.step === 'verify') this.verifyCode = code.trim()
  }

  cancelLogin(): void {
    this.loginRun?.abort()
    this.loginRun = undefined
    this.login = undefined
    this.verifyCode = undefined
  }

  private async followLogin(qrcode: string, run: AbortController): Promise<void> {
    let baseUrl: string | undefined
    let refreshes = 0
    while (!run.signal.aborted) {
      const code = this.verifyCode
      const state = await this.deps.client.qrStatus(qrcode, baseUrl, code, run.signal)
      if (run.signal.aborted) return
      if (code && state.status !== 'need_verifycode') this.verifyCode = undefined
      switch (state.status) {
        case 'wait': break
        case 'scanned': this.login = { step: 'scanned' }; break
        case 'redirect': baseUrl = state.baseUrl; this.login = { step: 'scanned' }; break
        case 'need_verifycode':
          this.login = { step: 'verify' }
          // Wait for the user to type the code before asking again.
          while (!this.verifyCode && !run.signal.aborted) await this.sleep(500, run.signal)
          break
        case 'expired': case 'verify_code_blocked': {
          if (++refreshes > QR_REFRESHES) { this.login = { step: 'failed', reason: 'QR_EXPIRED' }; return }
          const next = await this.deps.client.qrcode(run.signal)
          qrcode = next.qrcode; baseUrl = undefined
          this.login = { step: 'qr', url: next.url }
          break
        }
        case 'binded_redirect': this.login = { step: 'failed', reason: 'ALREADY_BOUND' }; return
        case 'confirmed': {
          await this.stop()
          this.deps.save({ account: state.account, enabled: true, buf: '' })
          this.login = undefined
          this.pausedUntil = undefined
          this.lastError = undefined
          this.start()
          return
        }
      }
    }
  }

  private run(account: IlinkAccount): void {
    const loop = new AbortController()
    this.loop = loop
    void this.poll(account, loop.signal).catch(error => {
      if (!loop.signal.aborted) this.lastError = error instanceof Error ? error.message : String(error)
    }).finally(() => {
      if (this.loop !== loop) return
      this.loop = undefined
      // An unexpected exit: come back after a pause rather than stay offline.
      if (!loop.signal.aborted) setTimeout(() => this.start(), backoff(3, this.random)).unref?.()
    })
  }

  private async poll(account: IlinkAccount, signal: AbortSignal): Promise<void> {
    const { client } = this.deps
    await client.notify(account, 'start').catch(() => {})
    let timeoutMs = LONG_POLL_MS
    let failures = 0
    let staleBefore = false
    while (!signal.aborted) {
      this.beat++
      if (this.pausedUntil !== undefined) {
        const wait = this.pausedUntil - this.now()
        if (wait > 0) { await this.sleep(wait, signal); continue }
      }
      const saved = this.deps.load()
      if (!saved || saved.account.token !== account.token) return
      const result = await client.updates(account, saved.buf, timeoutMs, signal)
      if (signal.aborted) return
      if (result.kind === 'stale') {
        // The first refusal may be temporary: wait an hour. A second one in a row means scan again.
        if (staleBefore) {
          this.deps.save({ ...saved, expired: true })
          this.pausedUntil = undefined
          this.lastError = 'TOKEN_EXPIRED'
          this.deps.log?.('WeChat token expired; the user has to scan again.')
          this.deps.expired?.()
          this.loop = undefined
          return
        }
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
      const seen = new Set(saved.seen ?? [])
      let contextToken = saved.contextToken
      for (const message of result.messages) {
        // Only the person who scanned the code talks to main chat.
        if (message.from !== account.userId || seen.has(message.id)) continue
        if (message.contextToken) contextToken = message.contextToken
        seen.add(message.id)
        if (!message.text) continue
        this.lastMessageAt = this.now()
        await this.deps.deliver(message)
        if (signal.aborted) return
      }
      // Saved after delivery: a crash in between repeats the round, and `seen` drops the repeats.
      const current = this.deps.load()
      if (!current || current.account.token !== account.token) return
      this.deps.save({ ...current, buf: result.buf, ...(contextToken ? { contextToken } : {}), seen: [...seen].slice(-SEEN_KEPT) })
    }
  }

  /** The loop has not polled for several long-poll periods: it is stuck, so start it again. */
  private lastBeat = { beat: -1, at: 0 }
  private checkBeat(): void {
    if (!this.loop || (this.pausedUntil ?? 0) > this.now()) { this.lastBeat = { beat: this.beat, at: this.now() }; return }
    if (this.beat !== this.lastBeat.beat) { this.lastBeat = { beat: this.beat, at: this.now() }; return }
    if (this.now() - this.lastBeat.at < 3 * (LONG_POLL_MS + 5000)) return
    this.deps.log?.('WeChat loop stalled; restarting it.')
    const loop = this.loop
    this.loop = undefined
    loop.abort()
    this.start()
  }
}
