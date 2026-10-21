import { AppError, QlooClient, ModelRouter, TasteAgent } from './agent.mjs';
import { SqlTasteStore } from './sql-store.mjs';
import { DurableBudget } from './durable-budget.mjs';

const security = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
// workerd supports manual/follow, not redirect:error. Never follow credentials.
async function edgeFetch(url, init) {
  const response = await fetch(url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) throw new Error('Provider redirects are forbidden.');
  return response;
}
const routes = new Set(['/api/state', '/api/chat', '/api/topics', '/api/search', '/api/confirm', '/api/recommend']);
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { ...security, ...headers } });

// One stable global object: never derive this ID from a client or visitor.
export default { async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (routes.has(path)) return env.TASTE.get(env.TASTE.idFromName('global-v1')).fetch(request);
  if (request.method === 'GET' && ['/', '/app.js', '/style.css'].includes(path)) {
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(security)) response.headers.set(key, value);
    return response;
  }
  return json({ error: 'Not found.' }, 404);
} };

export class TasteObject {
  constructor(ctx, env) {
    this.ctx = ctx; this.sql = ctx.storage.sql;
    this.store = new SqlTasteStore(this.sql);
    this.sql.exec('CREATE TABLE IF NOT EXISTS pending_search(token TEXT PRIMARY KEY, payload TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS request_rate(owner TEXT PRIMARY KEY, minute INTEGER NOT NULL, count INTEGER NOT NULL)');
    const caps = { qloo: Number(env.QLOO_MAX_REQUESTS ?? 0), model: Number(env.LLM_MAX_REQUESTS ?? 0) };
    const budget = new DurableBudget(this.sql, caps);
    const reserve = provider => async () => {
      budget.reserve(provider);
      // Persist the attempt before releasing any upstream request.
      await ctx.storage.sync();
    };
    this.qloo = new QlooClient({ fetchImpl: edgeFetch, apiKey: env.QLOO_API_KEY, maxRequests: caps.qloo, reserveRequest: reserve('qloo') });
    this.router = new ModelRouter({ fetchImpl: edgeFetch, apiKey: env.LLM_API_KEY, maxRequests: caps.model, reserveRequest: reserve('model') });
    this.agent = new TasteAgent(this.store, this.qloo, this.router);
    // Candidate confirmations survive object eviction; candidates remain private.
    this.agent.pending = {
      set: (token, item) => { this.sql.exec('INSERT OR REPLACE INTO pending_search VALUES(?,?,?)', token, JSON.stringify(item), item.expires); },
      get: token => { const row = Array.from(this.sql.exec('SELECT payload FROM pending_search WHERE token=?', token))[0]; return row ? JSON.parse(row.payload) : undefined; },
      delete: token => { this.sql.exec('DELETE FROM pending_search WHERE token=?', token); },
      [Symbol.iterator]: () => Array.from(this.sql.exec('SELECT token,payload FROM pending_search')).map(r => [r.token, JSON.parse(r.payload)])[Symbol.iterator](),
    };
    this.queues = new Map();
  }
  async fetch(request) {
    const headers = {};
    try {
      const url = new URL(request.url), path = url.pathname;
      if (!routes.has(path) || (path === '/api/state' ? request.method !== 'GET' : request.method !== 'POST')) throw new AppError('Not found.', 404);
      let body;
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== url.origin) throw new AppError('Cross-site requests are not allowed.', 403);
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new AppError('Use JSON requests.', 415);
        const reader = request.body?.getReader();
        if (!reader) throw new AppError('Invalid JSON.');
        const chunks = []; let size = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
          if (size > 8192) { await reader.cancel(); throw new AppError('Request too large.', 413); } chunks.push(value); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AppError('Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Invalid request.');
      }
      const cookie = /(?:^|;\s*)taste_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
      const known = cookie && Array.from(this.sql.exec('SELECT id FROM visitors WHERE id=?', cookie)).length;
      if (!known && Array.from(this.sql.exec('SELECT count(*) AS n FROM visitors'))[0].n >= 1000) throw new AppError('Demo visitor capacity reached.', 429);
      const owner = this.store.visitor(cookie);
      if (owner !== cookie) headers['Set-Cookie'] = `taste_session=${owner}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${url.protocol === 'https:' ? '; Secure' : ''}`;
      if (path === '/api/state') return json({ topics: this.store.topics(owner), qlooReady: Boolean(this.qloo.apiKey), modelReady: Boolean(this.router.apiKey), liveVerified: false, ephemeralStorage: false }, 200, headers);
      const minute = Math.floor(Date.now() / 60000);
      const rate = Array.from(this.sql.exec(`INSERT INTO request_rate VALUES(?,?,1) ON CONFLICT(owner) DO UPDATE SET
        count=CASE WHEN minute=excluded.minute THEN count+1 ELSE 1 END, minute=excluded.minute RETURNING count`, owner, minute))[0];
      if (rate.count > 20) throw new AppError('Please wait a minute before trying again.', 429);
      const previous = this.queues.get(owner) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(() => {
        if (path === '/api/topics') return { action: 'topic', topic: this.store.createTopic(owner, body.title) };
        if (path === '/api/chat') return this.agent.chat(owner, body.message);
        if (path === '/api/search') return this.agent.search(owner, body.topicId, body.query, body.category);
        if (path === '/api/confirm') return this.agent.confirm(owner, body.token, body.entityId);
        return this.agent.recommend(owner, body.topicId, body.category);
      });
      this.queues.set(owner, current);
      try { return json(await current, 200, headers); }
      finally { if (this.queues.get(owner) === current) this.queues.delete(owner); }
    } catch (error) { return json({ error: error instanceof AppError ? error.message : 'The request could not be completed.' }, error instanceof AppError ? error.status : 500, headers); }
  }
}
