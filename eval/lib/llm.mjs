// A small model client with a response cache so a rerun never pays twice, bounded concurrency,
// retries and a running bill. Two kinds of endpoint:
//   DeepSeek's Anthropic-compatible API, the one DSH itself uses:  DEEPSEEK_API_KEY (+ DEEPSEEK_BASE_URL)
//   any OpenAI-compatible API (/chat/completions):                OPENAI_API_KEY + OPENAI_BASE_URL + --model
// EVAL_EXTRA_BODY='{"…": …}' adds provider-specific fields to every request.
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
  const openai = !process.env.DEEPSEEK_API_KEY && !!process.env.OPENAI_API_KEY
  const key = openai ? process.env.OPENAI_API_KEY : process.env.DEEPSEEK_API_KEY
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

  /**
   * One completion. Returns the text; JSON is parsed when json is true (a fenced block is accepted).
   * @param request - { system, user, maxTokens, temperature, json, tag }
   */
  async function complete({ system, user, maxTokens = 2048, temperature, json = false, tag = '', details = false }) {
    // No temperature means the provider's default, as TheOne's own calls do.
    const sampling = { model, max_tokens: maxTokens, ...(temperature === undefined ? {} : { temperature }) }
    const body = openai
      ? { ...sampling, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...extra }
      : { ...sampling, system, messages: [{ role: 'user', content: user }], thinking: { type: 'disabled' }, ...extra }
    // Reasoning some models write before the answer (<think>…</think>, or only its end) is set aside, as TheOne does.
    const answer = text => text.includes('</think>') ? text.slice(text.lastIndexOf('</think>') + '</think>'.length) : text
    const parse = text => JSON.parse(answer(text).trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1').trim())
    // A malformed answer is never cached, so asking again can succeed.
    for (let attempt = 0; ; attempt++) {
      const hash = createHash('sha256').update(JSON.stringify([fake ? 'fake' : base, body, tag])).digest('hex').slice(0, 24)
      const file = cacheDir && join(cacheDir, `${hash}.json`)
      let text, used, cached = false
      // EVAL_REFRESH=1 asks the model again (to measure tokens and latency) but still saves the answers.
      if (file && existsSync(file) && !process.env.EVAL_REFRESH) { ({ text, usage: used } = JSON.parse(readFileSync(file, 'utf8'))); cached = true; usage.add({}, true) }
      else {
        await slot()
        try {
          if (fakeAnswer) { text = await fakeAnswer({ system, user, tag }); used = { input: Math.ceil((system.length + user.length) / 3), output: Math.ceil(text.length / 3) } }
          else if (openai) {
            const response = await send(body)
            text = String(response.choices?.[0]?.message?.content ?? '')
            const u = response.usage ?? {}
            used = { input: u.prompt_tokens, cached: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens, output: u.completion_tokens }
          } else {
            const response = await send(body)
            text = response.content.filter(block => block.type === 'text').map(block => block.text).join('')
            const u = response.usage ?? {}
            // Anthropic-style input_tokens leaves out the tokens read from cache.
            used = { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), cached: u.cache_read_input_tokens, output: u.output_tokens }
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
      // With details, this call's own tokens (as first measured, for a cached answer) and whether it was cached.
      return details ? { value, usage: used, cached } : value
    }
  }

  async function send(body) {
    for (let attempt = 0; ; attempt++) {
      let status = 0
      try {
        const response = await fetch(openai ? `${base}/chat/completions` : `${base}/v1/messages`, { method: 'POST', signal: AbortSignal.timeout(120000),
          headers: openai ? { 'content-type': 'application/json', authorization: `Bearer ${key}` }
            : { 'content-type': 'application/json', 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body) })
        status = response.status
        if (response.ok) return await response.json()
        const detail = (await response.text()).slice(0, 300)
        if (![408, 429, 500, 502, 503, 504].includes(status) || attempt >= 4) throw Object.assign(new Error(`${base} answered ${status}: ${detail}`), { fatal: true })
      } catch (error) {
        if (error.fatal || attempt >= 4) throw error
      }
      await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt))
    }
  }

  return { complete, usage, model: fakeAnswer ? `fake:${model}` : model }
}

/** Run tasks with the client's concurrency doing the throttling; results keep their order. */
export const all = tasks => Promise.all(tasks.map(task => task()))
