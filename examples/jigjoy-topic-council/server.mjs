import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = dirname(fileURLToPath(import.meta.url))
const clean = value => JSON.parse(JSON.stringify(value))
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}
const sameToken = (actual, expected) => typeof actual === 'string' && /^[a-f0-9]{64}$/.test(actual) && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))

export function createApp({ execute, database = join(root, '.data/council.db'), model = 'gemma3:1b', endpoint = 'http://127.0.0.1:11537', durationMs = 180000 } = {}) {
  const target = new URL(endpoint)
  if (target.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname) || target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Only a loopback Ollama origin is allowed')
  if (database !== ':memory:') mkdirSync(dirname(resolve(database)), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(database)
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, topic TEXT NOT NULL, brief TEXT NOT NULL, status TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', result TEXT, error TEXT);`)
  db.prepare("UPDATE runs SET status='interrupted', error='The local server stopped before this run completed. No result is inferred.' WHERE status='running'").run()
  const token = randomBytes(32).toString('hex')
  let active
  const getRun = id => {
    const row = db.prepare('SELECT * FROM runs WHERE id=?').get(id)
    if (!row) return undefined
    return { id: row.id, createdAt: row.created_at, topic: row.topic, brief: row.brief, status: row.status, events: JSON.parse(row.events), result: row.result ? JSON.parse(row.result) : null, error: row.error }
  }
  const emit = (id, event) => {
    const row = getRun(id)
    if (!row || row.events.length >= 500) return
    const item = clean({ recordedAt: new Date().toISOString(), ...event })
    row.events.push(item)
    db.prepare('UPDATE runs SET events=? WHERE id=?').run(JSON.stringify(row.events), id)
  }
  async function run({ topic, brief, onEvent, signal }) {
    if (execute) return execute({ topic, brief, onEvent, signal })
    const [{ runCouncil }, { createLocalRunner }] = await Promise.all([import('./council.mjs'), import('./local-runner.mjs')])
    const runner = createLocalRunner({ endpoint, model, signal, maxCalls: 4, onCall: event => onEvent({ type: 'inference.call', ...event }) })
    return runCouncil({ topic, brief, runner, onEvent, signal })
  }
  function launch(id, topic, brief) {
    const controller = new AbortController()
    const task = { id, controller, promise: null }
    active = task
    const timer = setTimeout(() => controller.abort(new Error('Local run time limit reached')), durationMs)
    task.promise = (async () => {
      try {
        emit(id, { type: 'run.started', message: 'Two local Mozaik agents are starting.' })
        const result = await run({ topic, brief, onEvent: event => emit(id, event), signal: controller.signal })
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Cancelled')
        db.prepare("UPDATE runs SET status='completed', result=? WHERE id=?").run(JSON.stringify(clean(result)), id)
        emit(id, { type: 'run.completed', message: 'The actual run completed.' })
      } catch (error) {
        const status = controller.signal.aborted ? 'cancelled' : 'failed'
        // Stop sibling inference when one agent fails; retain the original
        // failure classification rather than presenting it as user cancellation.
        if (!controller.signal.aborted) controller.abort(error)
        const message = String(error?.message ?? error).slice(0,1000)
        db.prepare('UPDATE runs SET status=?, error=? WHERE id=?').run(status, message, id)
        emit(id, { type: `run.${status}`, message })
      } finally {
        clearTimeout(timer)
        if (active === task) active = undefined
      }
    })()
  }
  const server = createServer(async (req, res) => {
    try {
      const port = server.address()?.port
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
      if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'Unrecognized local Host' })
      if (req.headers.origin && !hosts.map(host => `http://${host}`).includes(req.headers.origin)) return json(res, 403, { error: 'Cross-origin access is not allowed' })
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      if (req.method === 'GET' && url.pathname === '/api/status') {
        let ready = false
        let warning = 'Local model availability has not been verified.'
        try {
          const response = await fetch(new URL('/api/tags', target), { signal: AbortSignal.timeout(2000), redirect: 'error' })
          if (response.ok) { const data = await response.json(); ready = data.models?.some(item => item.name === model || item.model === model) === true; warning = ready ? 'Model files are available. This is not an inference or quality check.' : 'The configured model is not listed by the local Ollama service.' }
        } catch { warning = 'Start the configured local Ollama service. No cloud fallback is used.' }
        return json(res, 200, { model, endpoint, running: active?.id ?? null, ready, mode: 'local', warning, csrfToken: token })
      }
      if (req.method === 'GET' && url.pathname === '/api/runs') {
        const rows = db.prepare('SELECT id,created_at,topic,status,error FROM runs ORDER BY created_at DESC LIMIT 50').all()
        return json(res, 200, { runs: rows.map(row => ({ id: row.id, createdAt: row.created_at, topic: row.topic, status: row.status, error: row.error })) })
      }
      const match = /^\/api\/runs\/([a-f0-9-]{36})(\/cancel)?$/.exec(url.pathname)
      if (req.method === 'GET' && match && !match[2]) {
        const row = getRun(match[1]); return json(res, row ? 200 : 404, row ?? { error: 'Run not found' })
      }
      if (req.method === 'POST') {
        if (!sameToken(req.headers['x-council-token'], token)) return json(res, 403, { error: 'Reload the local page to obtain the current request token' })
        if (match?.[2]) {
          if (!active || active.id !== match[1]) return json(res, 409, { error: 'This run is not active' })
          active.controller.abort(new Error('Cancelled by the local user')); return json(res, 202, { id: match[1], status: 'cancelling' })
        }
        if (url.pathname !== '/api/runs') return json(res, 404, { error: 'Route not found' })
        if (active) return json(res, 409, { error: 'One council run is already active; its two agents share the local model.' })
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'Use application/json' })
        const chunks = []; let length = 0
        for await (const chunk of req) { length += chunk.length; if (length > 12000) return json(res, 413, { error: 'Request too large' }); chunks.push(chunk) }
        let body
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return json(res, 400, { error: 'Invalid JSON' }) }
        if (!body || typeof body.topic !== 'string' || !body.topic.trim() || body.topic.length > 120 || typeof body.brief !== 'string' || !body.brief.trim() || body.brief.length > 3000) return json(res, 400, { error: 'Supply a topic (1–120 characters) and brief (1–3000 characters)' })
        if (active) return json(res, 409, { error: 'A run started while this request was being read' })
        const id = randomUUID(), topic = body.topic.trim(), brief = body.brief.trim()
        db.prepare("INSERT INTO runs(id,created_at,topic,brief,status) VALUES(?,?,?,?,'running')").run(id, new Date().toISOString(), topic, brief)
        json(res, 202, { id }); launch(id, topic, brief); return
      }
      if (req.method === 'GET') {
        const asset = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'] }[url.pathname]
        if (asset) {
          res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" })
          res.end(readFileSync(join(root,'public',asset[0]))); return
        }
      }
      json(res, 404, { error: 'Route not found' })
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: 'Local request failed', detail: String(error?.message ?? error).slice(0,300) })
      else res.end()
    }
  })
  return {
    server, db,
    async listen(port = 3057) { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done) }); return `http://127.0.0.1:${server.address().port}` },
    async close() { if (active) { active.controller.abort(new Error('Server stopping')); await active.promise } await new Promise(done => server.close(done)); db.close() },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js24 or newer')
  const app = createApp({ database: process.env.COUNCIL_DB, model: process.env.COUNCIL_MODEL || 'gemma3:1b', endpoint: process.env.COUNCIL_OLLAMA_URL || 'http://127.0.0.1:11537' })
  console.log(`Topic Council: ${await app.listen(Number(process.env.COUNCIL_PORT || 3057))}`)
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0) })
}
