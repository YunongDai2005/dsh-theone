/**
 * Tencent's iLink bot protocol, as OpenClaw's WeChat channel speaks it: QR login, long-polled
 * updates, text replies and the typing indicator. Ported from @tencent-weixin/openclaw-weixin
 * (Copyright (C) 2026 Tencent, MIT); only what TheOne uses, with no OpenClaw dependency.
 * Independent of DSH so it can be tested and reused on its own.
 */
import { randomBytes } from 'node:crypto'

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
/** The server answers -14 when the bot token has expired or was revoked. */
export const STALE_TOKEN = -14
/** How long the server may hold getupdates, unless it suggests another value. */
export const LONG_POLL_MS = 35_000
/** A reply longer than this is sent in parts. */
export const TEXT_LIMIT = 4000

const APP_ID = 'bot'
const BOT_TYPE = '3'
const QR_POLL_MS = 35_000
const API_TIMEOUT_MS = 15_000
const LIGHT_TIMEOUT_MS = 10_000

/** A bound WeChat bot: what login returns and every later request needs. */
export interface IlinkAccount {
  botId: string
  token: string
  baseUrl: string
  /** The person who scanned the code; the only one whose messages reach main chat. */
  userId: string
}

export type QrState =
  | { status: 'wait' | 'scanned' | 'need_verifycode' | 'expired' | 'verify_code_blocked' | 'binded_redirect' }
  | { status: 'redirect'; baseUrl: string }
  | { status: 'confirmed'; account: IlinkAccount }

export interface InboundMessage {
  id: string
  from: string
  text: string
  contextToken?: string
}

export type UpdatesResult =
  | { kind: 'ok'; messages: InboundMessage[]; buf: string; nextTimeoutMs?: number }
  | { kind: 'stale' }
  | { kind: 'error'; message: string }

type Fetch = typeof fetch

/** `iLink-App-ClientVersion`: 0x00MMNNPP of a semantic version. */
export function clientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(part => Number.parseInt(part, 10) || 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

/** The words of a message: its text items, and the transcript WeChat attaches to a voice message. */
export function messageWords(items: readonly { type?: number; text_item?: { text?: string }; voice_item?: { text?: string } }[] | undefined): string {
  return (items ?? []).flatMap(item => item.type === 1 && item.text_item?.text ? [item.text_item.text]
    : item.type === 3 && item.voice_item?.text ? [item.voice_item.text] : []).join('\n').trim()
}

export class IlinkClient {
  private readonly version: string
  private readonly tickets = new Map<string, string>()

  /** The HTTP client; replaced in tests by a scripted server. */
  fetchImpl: Fetch

  constructor(version: string, fetchImpl: Fetch = (input, init) => fetch(input, init), private readonly botAgent = 'TheOne') {
    this.version = version
    this.fetchImpl = fetchImpl
  }

  /** A new login code; `url` is what the QR image encodes. */
  async qrcode(signal?: AbortSignal): Promise<{ qrcode: string; url: string }> {
    const body = await this.call(ILINK_BASE_URL, `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, { local_token_list: [] }, { timeoutMs: API_TIMEOUT_MS, signal })
    const parsed = body as { qrcode?: string; qrcode_img_content?: string }
    if (!parsed.qrcode || !parsed.qrcode_img_content) throw new Error('ILINK_QR_MISSING')
    return { qrcode: parsed.qrcode, url: parsed.qrcode_img_content }
  }

  /** Long-poll the login code's state; a timeout or a gateway error reads as still waiting. */
  async qrStatus(qrcode: string, baseUrl = ILINK_BASE_URL, verifyCode?: string, signal?: AbortSignal): Promise<QrState> {
    let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`
    let body: Record<string, unknown>
    try { body = await this.call(baseUrl, endpoint, undefined, { timeoutMs: QR_POLL_MS, signal }) as Record<string, unknown> }
    catch (error) {
      if (signal?.aborted) throw error
      return { status: 'wait' }
    }
    switch (body.status) {
      case 'confirmed': {
        const token = typeof body.bot_token === 'string' ? body.bot_token : ''
        const botId = typeof body.ilink_bot_id === 'string' ? body.ilink_bot_id : ''
        const userId = typeof body.ilink_user_id === 'string' ? body.ilink_user_id : ''
        if (!token || !botId || !userId) throw new Error('ILINK_LOGIN_INCOMPLETE')
        return { status: 'confirmed', account: { botId, token, userId, baseUrl: typeof body.baseurl === 'string' && body.baseurl ? body.baseurl : ILINK_BASE_URL } }
      }
      case 'scaned_but_redirect':
        return typeof body.redirect_host === 'string' && body.redirect_host ? { status: 'redirect', baseUrl: `https://${body.redirect_host}` } : { status: 'scanned' }
      case 'scaned': return { status: 'scanned' }
      case 'need_verifycode': case 'expired': case 'verify_code_blocked': case 'binded_redirect': return { status: body.status }
      default: return { status: 'wait' }
    }
  }

  /**
   * One long poll for new messages. A client-side timeout is an ordinary empty round, not a failure;
   * messages the bot sent itself are left out.
   */
  async updates(account: IlinkAccount, buf: string, timeoutMs = LONG_POLL_MS, signal?: AbortSignal): Promise<UpdatesResult> {
    let body: Record<string, unknown>
    try {
      body = await this.call(account.baseUrl, 'ilink/bot/getupdates', { get_updates_buf: buf, base_info: this.baseInfo() },
        { token: account.token, timeoutMs: timeoutMs + 5000, signal }) as Record<string, unknown>
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof Error && error.name === 'TimeoutError') return { kind: 'ok', messages: [], buf }
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
    }
    const ret = typeof body.ret === 'number' ? body.ret : 0
    const errcode = typeof body.errcode === 'number' ? body.errcode : 0
    if (ret === STALE_TOKEN || errcode === STALE_TOKEN) return { kind: 'stale' }
    if (ret !== 0 || errcode !== 0) return { kind: 'error', message: `ret=${ret} errcode=${errcode} ${typeof body.errmsg === 'string' ? body.errmsg : ''}`.trim() }
    const raw = Array.isArray(body.msgs) ? body.msgs as Record<string, unknown>[] : []
    const messages = raw.flatMap((message): InboundMessage[] => {
      // 2 is the bot's own message; group messages are not for main chat.
      if (message.message_type === 2 || message.group_id) return []
      const text = messageWords(message.item_list as Parameters<typeof messageWords>[0])
      const from = typeof message.from_user_id === 'string' ? message.from_user_id : ''
      const id = message.message_id ?? message.seq ?? message.client_id
      if (!from || id === undefined) return []
      return [{ id: String(id), from, text, ...(typeof message.context_token === 'string' && message.context_token ? { contextToken: message.context_token } : {}) }]
    })
    const next = typeof body.longpolling_timeout_ms === 'number' && body.longpolling_timeout_ms > 0 ? body.longpolling_timeout_ms : undefined
    return { kind: 'ok', messages, buf: typeof body.get_updates_buf === 'string' && body.get_updates_buf ? body.get_updates_buf : buf, ...(next ? { nextTimeoutMs: next } : {}) }
  }

  /** Send one text message; `contextToken` from the message it answers ties it to that conversation. */
  async send(account: IlinkAccount, to: string, text: string, contextToken?: string): Promise<void> {
    const body = await this.call(account.baseUrl, 'ilink/bot/sendmessage', {
      msg: { from_user_id: '', to_user_id: to, client_id: `theone-${randomBytes(8).toString('hex')}`, message_type: 2, message_state: 2,
        item_list: [{ type: 1, text_item: { text } }], ...(contextToken ? { context_token: contextToken } : {}) },
      base_info: this.baseInfo(),
    }, { token: account.token, timeoutMs: API_TIMEOUT_MS }) as { ret?: number; errcode?: number; errmsg?: string }
    if ((body.ret ?? 0) !== 0 || (body.errcode ?? 0) !== 0) throw new Error(`ILINK_SEND_FAILED ret=${body.ret ?? 0} errcode=${body.errcode ?? 0}`)
  }

  /** Show or clear "typing…" to `to`; best effort, the ticket is fetched once per person. */
  async typing(account: IlinkAccount, to: string, on: boolean, contextToken?: string): Promise<void> {
    let ticket = this.tickets.get(to)
    if (!ticket) {
      const config = await this.call(account.baseUrl, 'ilink/bot/getconfig', { ilink_user_id: to, ...(contextToken ? { context_token: contextToken } : {}), base_info: this.baseInfo() },
        { token: account.token, timeoutMs: LIGHT_TIMEOUT_MS }) as { typing_ticket?: string }
      if (!config.typing_ticket) return
      ticket = config.typing_ticket
      this.tickets.set(to, ticket)
    }
    await this.call(account.baseUrl, 'ilink/bot/sendtyping', { ilink_user_id: to, typing_ticket: ticket, status: on ? 1 : 2, base_info: this.baseInfo() },
      { token: account.token, timeoutMs: LIGHT_TIMEOUT_MS })
  }

  /** Tell the server this client starts or stops receiving; best effort. */
  async notify(account: IlinkAccount, state: 'start' | 'stop'): Promise<void> {
    await this.call(account.baseUrl, `ilink/bot/msg/notify${state}`, { base_info: this.baseInfo() }, { token: account.token, timeoutMs: LIGHT_TIMEOUT_MS })
  }

  private baseInfo() {
    return { channel_version: this.version, bot_agent: this.botAgent }
  }

  private async call(baseUrl: string, endpoint: string, body: unknown, options: { token?: string; timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
    const headers: Record<string, string> = {
      'iLink-App-Id': APP_ID,
      'iLink-App-ClientVersion': String(clientVersion(this.version)),
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers.AuthorizationType = 'ilink_bot_token'
      // A random uint32, as decimal text, base64-encoded.
      headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE(0))).toString('base64')
      if (options.token) headers.Authorization = `Bearer ${options.token}`
    }
    const timeout = AbortSignal.timeout(options.timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    try {
      const response = await this.fetchImpl(url, { method: body === undefined ? 'GET' : 'POST', headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const text = await response.text()
      if (!response.ok) throw new Error(`ILINK_HTTP_${response.status}`)
      return text ? JSON.parse(text) : {}
    } catch (error) {
      // Our own time limit is told apart from the caller's cancellation.
      if (timeout.aborted && !options.signal?.aborted) { const expired = new Error('ILINK_TIMEOUT'); expired.name = 'TimeoutError'; throw expired }
      throw error
    }
  }
}
