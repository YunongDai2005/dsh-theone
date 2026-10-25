/** A scripted Telegram Bot API behind a `fetch` function: tests queue updates, and it records calls. */
export interface TelegramCall { token: string; method: string; body: Record<string, unknown> }

type Answer = { ok: boolean; result?: unknown; error_code?: number; description?: string }

export class FakeTelegram {
  calls: TelegramCall[] = []
  sent: { chatId: number; text: string }[] = []
  private updates: Record<string, unknown>[] = []
  private nextUpdate = 1
  private readonly answers = new Map<string, Answer[]>()
  private waiting: (() => void)[] = []

  constructor(readonly username = 'theone_test_bot') {}

  /** Queue an answer for one method, used once ahead of the default behaviour (an error, say). */
  answer(method: string, ...answers: Answer[]): this {
    this.answers.set(method, [...this.answers.get(method) ?? [], ...answers])
    for (const wake of this.waiting.splice(0)) wake()
    return this
  }

  /** A private message from a person, as getUpdates delivers it. */
  say(text: string, from = { id: 42, first_name: 'Owner', username: 'owner' }, chat: { id: number; type: string } = { id: from.id, type: 'private' }) {
    const id = this.nextUpdate++
    this.updates.push({ update_id: id, message: { message_id: id, text, from, chat } })
    for (const wake of this.waiting.splice(0)) wake()
    return id
  }

  /** Resolves once `count` calls to `method` were made. */
  async until(method: string, count: number, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.calls.filter(call => call.method === method).length < count) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} × ${method}`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const [, token, method] = new URL(String(input)).pathname.match(/^\/bot([^/]+)\/(\w+)$/) ?? []
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    this.calls.push({ token, method, body })
    const signal = init?.signal ?? undefined
    const reply = (answer: Answer) => new Response(JSON.stringify(answer), { status: answer.ok ? 200 : answer.error_code ?? 400, headers: { 'content-type': 'application/json' } })
    const queued = this.answers.get(method)?.shift()
    if (queued) return reply(queued)
    switch (method) {
      case 'getMe': return reply({ ok: true, result: { id: 1, is_bot: true, username: this.username } })
      case 'sendMessage':
        this.sent.push({ chatId: Number(body.chat_id), text: String(body.text) })
        return reply({ ok: true, result: { message_id: 1 } })
      case 'getUpdates': {
        const offset = Number(body.offset ?? 0)
        // Held open until an update newer than the offset arrives, as Telegram's long poll does.
        const alive = setInterval(() => {}, 1000)
        try {
          while (!this.updates.some(update => Number(update.update_id) >= offset) && !this.answers.get('getUpdates')?.length) {
            await new Promise<void>((resolve, reject) => {
              this.waiting.push(resolve)
              if (signal?.aborted) reject(signal.reason)
              signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
            })
          }
        } finally { clearInterval(alive) }
        const again = this.answers.get('getUpdates')?.shift()
        if (again) return reply(again)
        return reply({ ok: true, result: this.updates.filter(update => Number(update.update_id) >= offset) })
      }
      default: return reply({ ok: true, result: true })
    }
  }) as typeof fetch
}
