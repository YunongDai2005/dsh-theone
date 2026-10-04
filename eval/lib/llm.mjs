// A small client for DeepSeek's Anthropic-compatible endpoint (the one DSH itself uses), with a
// response cache so a rerun never pays twice, bounded concurrency, retries and a running bill.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** USD per million tokens; DeepSeek V4.1 Flash peak prices in October 2026. Override with EVAL_PRICES="in,cached,out". */
const PRICES = (process.env.EVAL_PRICES ?? '0.30,0.006,1.20').split(',').map(Number)

export class Usage {
  calls = 0; cached = 0; input = 0; cacheHit = 0; output = 0
  add(usage, fromCache) {
    this.calls++
    if (fromCache) { this.cached++; return }
    this.input += usage.input_tokens ?? 0
    this.cacheHit += usage.cache_read_input_tokens ?? 0
    this.output += usage.output_tokens ?? 0
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
  const key = process.env.DEEPSEEK_API_KEY
  if (!fakeAnswer && !key) throw new Error('Set DEEPSEEK_API_KEY, or use --dry-run to try the pipeline with a fake model.')
  const base = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic').replace(/\/$/, '')
  if (cacheDir) mkdirSync(cacheDir, { recursive: true })
  let active = 0
  const queue = []
  const slot = () => active < concurrency ? (active++, Promise.resolve()) : new Promise(resolve => queue.push(resolve))
  const release = () => { const next = queue.shift(); if (next) next(); else active-- }

  /**
   * One completion. Returns the text; JSON is parsed when json is true (a fenced block is accepted).
   * @param request - { system, user, maxTokens, temperature, json, tag }
   */
  async function complete({ system, user, maxTokens = 2048, temperature, json = false, tag = '' }) {
    // No temperature means the provider's default, as TheOne's own calls do.
    const body = { model, max_tokens: maxTokens, ...(temperature === undefined ? {} : { temperature }), system, messages: [{ role: 'user', content: user }], thinking: { type: 'disabled' } }
    const parse = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1').trim())
    // A malformed answer is never cached, so asking again can succeed.
    for (let attempt = 0; ; attempt++) {
      const hash = createHash('sha256').update(JSON.stringify([fake ? 'fake' : base, body, tag])).digest('hex').slice(0, 24)
      const file = cacheDir && join(cacheDir, `${hash}.json`)
      let text
      if (file && existsSync(file)) { text = JSON.parse(readFileSync(file, 'utf8')).text; usage.add({}, true) }
      else {
        await slot()
        try {
          if (fakeAnswer) { text = await fakeAnswer({ system, user, tag }); usage.add({ input_tokens: Math.ceil((system.length + user.length) / 3), output_tokens: Math.ceil(text.length / 3) }) }
          else {
            const response = await send(body)
            text = response.content.filter(block => block.type === 'text').map(block => block.text).join('')
            usage.add(response.usage ?? {})
          }
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
      if (file && !existsSync(file)) writeFileSync(file, JSON.stringify({ text }))
      return value
    }
  }

  async function send(body) {
    for (let attempt = 0; ; attempt++) {
      let status = 0
      try {
        const response = await fetch(`${base}/v1/messages`, { method: 'POST', signal: AbortSignal.timeout(120000),
          headers: { 'content-type': 'application/json', 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body) })
        status = response.status
        if (response.ok) return await response.json()
        const detail = (await response.text()).slice(0, 300)
        if (![408, 429, 500, 502, 503, 504].includes(status) || attempt >= 4) throw Object.assign(new Error(`DeepSeek ${status}: ${detail}`), { fatal: true })
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
