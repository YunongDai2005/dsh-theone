/**
 * One WeChat account for main chat: QR login, and receiving through iLink's long poll (the loop,
 * backoff and restarts are the generic `RemoteLink`'s). Knows nothing of DSH.
 */
import { IlinkClient, LONG_POLL_MS, type IlinkAccount } from './weixin-ilink.ts'
import { RemoteLink, type LinkSaved, type LinkSource, type LinkStatus, type RemoteLinkDeps } from './remote-link.ts'

/** What is saved between runs. The token never leaves the host. */
export interface WeixinSaved extends LinkSaved {
  account: IlinkAccount
  /** The latest conversation token from the owner; replies carry it. */
  contextToken?: string
}

export type LoginState =
  | { step: 'qr'; url: string }
  | { step: 'scanned' }
  | { step: 'verify' }
  | { step: 'failed'; reason: string }

export interface WeixinStatus extends LinkStatus {
  login?: LoginState
}

const QR_REFRESHES = 3

/** Polling iLink: only the person who scanned the code reaches main chat; -14 is a refused token. */
export function weixinSource(client: IlinkClient): LinkSource<WeixinSaved> {
  return {
    timeoutMs: LONG_POLL_MS,
    identity: saved => saved.account.token,
    label: saved => saved.account.botId.slice(0, 8),
    started: saved => client.notify(saved.account, 'start'),
    stopped: saved => client.notify(saved.account, 'stop'),
    poll: async (saved, timeoutMs, signal) => {
      const result = await client.updates(saved.account, saved.cursor, timeoutMs, signal)
      if (result.kind !== 'ok') return result
      const own = result.messages.filter(message => message.from === saved.account.userId)
      const contextToken = own.findLast(message => message.contextToken)?.contextToken
      return { kind: 'ok', cursor: result.buf, messages: own.map(message => ({ id: message.id, text: message.text })),
        ...(contextToken ? { patch: { contextToken } } : {}), ...(result.nextTimeoutMs ? { nextTimeoutMs: result.nextTimeoutMs } : {}) }
    },
  }
}

export class WeixinLink extends RemoteLink<WeixinSaved> {
  private loginRun?: AbortController
  private login?: LoginState
  private verifyCode?: string

  constructor(private readonly client: IlinkClient, deps: Omit<RemoteLinkDeps<WeixinSaved>, 'source'>) {
    super({ ...deps, source: weixinSource(client) })
  }

  override status(): WeixinStatus {
    return { ...super.status(), ...(this.login ? { login: this.login } : {}) }
  }

  /** The bound account, for replies. */
  account(): IlinkAccount | undefined {
    return this.current()?.account
  }

  contextToken(): string | undefined {
    return this.deps.load()?.contextToken
  }

  override async logout(): Promise<void> {
    this.cancelLogin()
    await super.logout()
  }

  /** Begin a QR login; progress is read from `status().login`. */
  async beginLogin(): Promise<LoginState> {
    this.cancelLogin()
    const run = new AbortController()
    this.loginRun = run
    try {
      const code = await this.client.qrcode(run.signal)
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
      const state = await this.client.qrStatus(qrcode, baseUrl, code, run.signal)
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
          const next = await this.client.qrcode(run.signal)
          qrcode = next.qrcode; baseUrl = undefined
          this.login = { step: 'qr', url: next.url }
          break
        }
        case 'binded_redirect': this.login = { step: 'failed', reason: 'ALREADY_BOUND' }; return
        case 'confirmed':
          this.login = undefined
          await this.bind({ account: state.account, enabled: true, cursor: '' })
          return
      }
    }
  }
}
