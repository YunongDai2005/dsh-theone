// A small model client with a response cache so a rerun never pays twice, bounded concurrency,
// retries and a running bill. Two kinds of endpoint:
//   DeepSeek's Anthropic-compatible API, the one DSH itself uses:  DEEPSEEK_API_KEY (+ DEEPSEEK_BASE_URL)
//   any OpenAI-compatible API (/chat/completions):                OPENAI_API_KEY + OPENAI_BASE_URL + --model
// EVAL_EXTRA_BODY='{"…": …}' adds provider-specific fields to every request.
// EVAL_RPM=28 spaces requests evenly to stay under a provider's calls-per-minute limit.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** USD per million tokens; DeepSeek V4.1 Flash peak prices in October 2026. Override with EVAL_PRICES="in,cached,out". */
const PRICES = (process.env.EVAL_PRICES ?? '0.30,0.006,1.20').split(',').map(Number)

export class Usage {
  calls = 0; cached = 0; input = 0; cacheHit = 0; output = 0
  /** usage: { input (all prompt tokens, cached ones included), cached, output } */
  add(usage, fromCache) {
    this.calls++
    if (fromCache) { this.cached++; return }
    this.input += usage.input ?? 0
    this.cacheHit += usage.cached ?? 0
    this.output += usage.output ?? 0
  }
  get cost() {
    const [input, cached, output] = PRICES
    return ((this.input - this.cacheHit) * input + this.cacheHit * cached + this.output * output) / 1e6
  }
  toString() {
    return `${this.calls} calls (${this.cached} from cache) · input ${this.input} tokens (${this.cacheHit} cache hits) · output ${this.output} · ~$${this.cost.toFixed(3)}`
  }
}

/**
 * Create a model client.
 * @param options.model - e.g. deepseek-flash
 * @param options.cacheDir - responses are kept here by request hash
 * @param options.fake - path of a module whose default export answers requests (tests, dry runs)
 */
export async function createClient({ model = process.env.EVAL_MODEL ?? 'deepseek-flash', cacheDir, concurrency = Number(process.env.EVAL_CONCURRENCY ?? 4), fake } = {}) {
  const usage = new Usage()
  const fakeAnswer = fake ? (await import(pathToFileURL(fake).href)).default : undefined
  const openai = !fakeAnswer && !process.env.DEEPSEEK_API_KEY && !!process.env.OPENAI_API_KEY
  const key = fakeAnswer ? undefined : openai ? process.env.OPENAI_API_KEY : process.env.DEEPSEEK_API_KEY
  if (!fakeAnswer && !key) throw new Error('Set DEEPSEEK_API_KEY, or OPENAI_API_KEY with OPENAI_BASE_URL, or use --dry-run to try the pipeline with a fake model.')
  if (!fakeAnswer && openai && !process.env.OPENAI_BASE_URL) throw new Error('Set OPENAI_BASE_URL to the provider\'s OpenAI-compatible address (usually ending in /v1).')
  if (!fakeAnswer && openai && model === 'deepseek-flash' && !process.env.EVAL_MODEL) throw new Error('Name the provider\'s model with --model (or EVAL_MODEL).')
  const base = (openai ? process.env.OPENAI_BASE_URL : process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic').replace(/\/$/, '')
  let extra = {}
  try { extra = JSON.parse(process.env.EVAL_EXTRA_BODY ?? '{}') } catch { throw new Error('EVAL_EXTRA_BODY must be a JSON object') }
  if (cacheDir) mkdirSync(cacheDir, { recursive: true })
  let active = 0
  const queue = []
  const slot = () => active < concurrency ? (active++, Promise.resolve()) : new Promise(resolve => queue.push(resolve))
  const release = () => { const next = queue.shift(); if (next) next(); else active-- }

  const rowUsage = used => ({ input: used?.input ?? 0, output: used?.output ?? 0, cache_hit: used?.cached ?? 0 })
  const providerUsage = response => {
    const u = response?.usage ?? {}
    return openai
      ? { input: u.prompt_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0, output: u.completion_tokens ?? 0 }
      // Anthropic-style input_tokens leaves out tokens read from cache.
      : { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 }
  }
  const measuredUsage = metrics => metrics.usage_by_call.reduce((sum, used) => ({ input: sum.input + used.input,
    output: sum.output + used.output, cached: sum.cached + used.cache_hit }), { input: 0, output: 0, cached: 0 })

  /**
   * One completion. Returns the text; JSON is parsed when json is true (a fenced block is accepted).
   * @param request - { system, user, maxTokens, temperature, json, tag }
   */
  /** @param request.override - fields merged over EVAL_EXTRA_BODY for this call; null removes one (e.g. to keep thinking on). */
  async function complete({ system, user, maxTokens = 2048, temperature, json = false, tag = '', details = false, override }) {
    const sampling = { model, max_tokens: maxTokens, ...(temperature === undefined ? {} : { temperature }) }
    const fields = Object.fromEntries(Object.entries({ ...extra, ...override }).filter(([, value]) => value !== null))
    const body = openai
      ? { ...sampling, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...fields }
      : { ...sampling, system, messages: [{ role: 'user', content: user }], ...(override?.thinking === null ? {} : { thinking: { type: 'disabled' } }), ...fields }
    const answer = text => text.includes('</think>') ? text.slice(text.lastIndexOf('</think>') + '</think>'.length) : text
    const parse = text => JSON.parse(answer(text).trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1').trim())
    const metrics = { calls: 0, latency_ms: 0, usage_by_call: [], latency_by_call: [] }
    try {
      // A malformed answer is never cached, so asking again can succeed.
      for (let attempt = 0; ; attempt++) {
        const hash = createHash('sha256').update(JSON.stringify([fake ? 'fake' : base, body, tag])).digest('hex').slice(0, 24)
        const file = cacheDir && join(cacheDir, `${hash}.json`)
        let text, used, cached = false
        if (file && existsSync(file) && !process.env.EVAL_REFRESH) {
          ({ text, usage: used } = JSON.parse(readFileSync(file, 'utf8')))
          cached = true
          usage.add({}, true)
        } else {
          await slot()
          try {
            if (fakeAnswer) {
              const started = performance.now()
              try {
                text = await fakeAnswer({ system, user, tag })
                used = { input: Math.ceil((system.length + user.length) / 3), output: Math.ceil(text.length / 3) }
              } finally {
                metrics.calls++
                const elapsed = performance.now() - started
                metrics.latency_ms += elapsed
                metrics.latency_by_call.push(elapsed)
                metrics.usage_by_call.push(rowUsage(used))
              }
            } else {
              const response = await send(body, metrics)
              text = openai ? String(response.choices?.[0]?.message?.content ?? '')
                : response.content.filter(block => block.type === 'text').map(block => block.text).join('')
              used = providerUsage(response)
            }
            usage.add(used)
          } finally { release() }
        }
        let value = text
        if (json) {
          try { value = parse(text) }
          catch {
            if (attempt >= 2) throw new Error(`Model did not return JSON (${tag}): ${text.slice(0, 200)}`)
            continue
          }
        }
        if (file && !cached) writeFileSync(file, JSON.stringify({ text, usage: used }))
        // Keep the original token estimate on disk-cache replays, as before. No request or latency
        // is charged to this replay; usage_by_call describes only requests actually sent now.
        return details ? { value, usage: metrics.calls ? measuredUsage(metrics) : used, cached,
          ...metrics, latency_ms: Math.round(metrics.latency_ms) } : value
      }
    } catch (error) {
      throw Object.assign(error, metrics, { latency_ms: Math.round(metrics.latency_ms), usage: measuredUsage(metrics) })
    }
  }

  // Each request (retries included) takes the next free start time, so a per-minute limit is never hit.
  const spacing = Number(process.env.EVAL_RPM) > 0 ? 60000 / Number(process.env.EVAL_RPM) : 0
  let nextStart = 0
  const paced = async () => {
    if (!spacing) return
    const at = Math.max(Date.now(), nextStart)
    nextStart = at + spacing
    if (at > Date.now()) await new Promise(resolve => setTimeout(resolve, at - Date.now()))
  }

  async function send(body, metrics) {
    for (let attempt = 0; ; attempt++) {
      let status = 0
      await paced()
      const started = performance.now()
      let decoded
      try {
        const response = await fetch(openai ? `${base}/chat/completions` : `${base}/v1/messages`, { method: 'POST', signal: AbortSignal.timeout(120000),
          headers: openai ? { 'content-type': 'application/json', authorization: `Bearer ${key}` }
            : { 'content-type': 'application/json', 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body) })
        status = response.status
        if (response.ok) { decoded = await response.json(); return decoded }
        const detail = (await response.text()).slice(0, 300)
        // A rate limit is waited out longer than other failures: aggregators often allow only so many calls a minute.
        if (![408, 429, 500, 502, 503, 504].includes(status) || attempt >= (status === 429 ? 10 : 4)) throw Object.assign(new Error(`${base} answered ${status}: ${detail}`), { fatal: true })
      } catch (error) {
        if (error.fatal || (attempt >= 4 && status !== 429)) throw error
      } finally {
        metrics.calls++
        const elapsed = performance.now() - started
        metrics.latency_ms += elapsed
        metrics.latency_by_call.push(elapsed)
        metrics.usage_by_call.push(rowUsage(providerUsage(decoded)))
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, 2000 * 2 ** attempt) * (0.75 + Math.random() / 2)))
    }
  }

  return { complete, usage, model: fakeAnswer ? `fake:${model}` : model }
}

/** Run tasks with the client's concurrency doing the throttling; results keep their order. */
export const all = tasks => Promise.all(tasks.map(task => task()))
