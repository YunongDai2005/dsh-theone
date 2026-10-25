/** A scripted iLink server behind a `fetch` function: tests queue answers, and it records requests. */
export interface IlinkRequest { path: string; method: string; headers: Record<string, string>; body?: Record<string, unknown>; query: URLSearchParams; host: string }

type Answer = Record<string, unknown> | ((request: IlinkRequest, signal?: AbortSignal) => Promise<Record<string, unknown>> | Record<string, unknown>)

export class FakeIlink {
  requests: IlinkRequest[] = []
  sent: { to: string; text: string; contextToken?: string }[] = []
  private readonly queues = new Map<string, Answer[]>()
  private readonly waiting = new Map<string, (() => void)[]>()

  /** Queue the next answer for an endpoint ("getupdates", "get_qrcode_status", …). */
  answer(endpoint: string, ...answers: Answer[]): this {
    const queue = this.queues.get(endpoint) ?? []
    queue.push(...answers)
    this.queues.set(endpoint, queue)
    for (const wake of this.waiting.get(endpoint)?.splice(0) ?? []) wake()
    return this
  }

  /** A message from `from`, as getupdates delivers it. */
  static message(id: number, from: string, text: string, extra: Record<string, unknown> = {}) {
    return { message_id: id, from_user_id: from, message_type: 1, context_token: `ctx-${id}`, item_list: [{ type: 1, text_item: { text } }], ...extra }
  }

  /** Resolves once `count` requests have reached `endpoint`. */
  async until(endpoint: string, count: number, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.requests.filter(request => request.path.endsWith(endpoint)).length < count) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} × ${endpoint}`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
    const request: IlinkRequest = { path: url.pathname, method: init?.method ?? 'GET', headers, query: url.searchParams, host: url.host,
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}) }
    this.requests.push(request)
    const endpoint = url.pathname.split('/').at(-1)!
    if (endpoint === 'sendmessage') {
      const msg = request.body!.msg as { to_user_id: string; context_token?: string; item_list: { text_item: { text: string } }[] }
      this.sent.push({ to: msg.to_user_id, text: msg.item_list[0].text_item.text, ...(msg.context_token ? { contextToken: msg.context_token } : {}) })
    }
    const signal = init?.signal ?? undefined
    let answer = this.queues.get(endpoint)?.shift()
    // Long polls with nothing queued hold until something is queued or the request is aborted.
    while (answer === undefined && (endpoint === 'getupdates' || endpoint === 'get_qrcode_status')) {
      // AbortSignal.timeout does not keep the process alive; a held request does, as a real socket would.
      const alive = setInterval(() => {}, 1000)
      try {
        await new Promise<void>((resolve, reject) => {
          const list = this.waiting.get(endpoint) ?? []
          list.push(resolve)
          this.waiting.set(endpoint, list)
          if (signal?.aborted) reject(signal.reason)
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      } finally { clearInterval(alive) }
      answer = this.queues.get(endpoint)?.shift()
    }
    const body = typeof answer === 'function' ? await answer(request, signal) : answer ?? { ret: 0 }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}
