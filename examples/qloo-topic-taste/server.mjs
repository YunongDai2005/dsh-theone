import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, TasteStore, QlooClient, ModelRouter, TasteAgent, text } from './core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export function createApp({ store, qloo, router }) {
  const agent = new TasteAgent(store, qloo, router), limits = new Map(), queues = new Map();
  const assets = new Map([['/', ['text/html', readFileSync(join(here, 'public/index.html'))]], ['/app.js', ['text/javascript', readFileSync(join(here, 'public/app.js'))]], ['/style.css', ['text/css', readFileSync(join(here, 'public/style.css'))]]]);
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && assets.has(path)) { const [type, body] = assets.get(path); res.setHeader('Content-Type', `${type}; charset=utf-8`); res.end(body); return; }
      const cookie = /(?:^|;\s*)taste_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
      const owner = store.visitor(cookie);
      if (owner !== cookie) res.setHeader('Set-Cookie', `taste_session=${owner}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
      let result;
      if (req.method === 'GET' && path === '/api/state') result = { topics: store.topics(owner), qlooReady: Boolean(qloo.apiKey), modelReady: Boolean(router.apiKey), liveVerified: false };
      else if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Use JSON requests.', 415);
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new AppError('Cross-site requests are not allowed.', 403);
        const minute = Math.floor(Date.now() / 60000), prior = limits.get(owner);
        const count = prior?.minute === minute ? prior.count + 1 : 1;
        limits.set(owner, { minute, count });
        if (count > 20) throw new AppError('Please wait a minute before trying again.', 429);
        let raw = ''; for await (const part of req) { raw += part; if (Buffer.byteLength(raw) > 8192) throw new AppError('Request too large.', 413); }
        let body; try { body = JSON.parse(raw); } catch { throw new AppError('Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Invalid request.');
        const prev = queues.get(owner) ?? Promise.resolve();
        const current = prev.catch(() => {}).then(async () => {
          if (path === '/api/chat') return agent.chat(owner, body.message);
          if (path === '/api/topics') return { action: 'topic', topic: store.createTopic(owner, text(body.title, 80)) };
          if (path === '/api/search') return agent.search(owner, body.topicId, body.query, body.category);
          if (path === '/api/confirm') return agent.confirm(owner, body.token, body.entityId);
          if (path === '/api/recommend') return agent.recommend(owner, body.topicId, body.category);
          throw new AppError('Not found.', 404);
        });
        queues.set(owner, current);
        try { result = await current; } finally { if (queues.get(owner) === current) queues.delete(owner); }
      } else throw new AppError('Not found.', 404);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (err) { res.statusCode = err instanceof AppError ? err.status : 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: err instanceof AppError ? err.message : 'The request could not be completed.' })); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.TASTE_DB ?? join(here, '.data/taste.db'); mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const store = new TasteStore(dbPath);
  const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, baseURL: process.env.QLOO_BASE_URL, maxRequests: process.env.QLOO_MAX_REQUESTS ?? 200 });
  const router = new ModelRouter({ apiKey: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL, maxRequests: process.env.LLM_MAX_REQUESTS ?? 100 });
  const app = createApp({ store, qloo, router });
  app.listen(Number(process.env.PORT ?? 3057), process.env.HOST ?? '127.0.0.1', () => console.log('TheOne Topic Taste ready. Keys remain server-side; live Qloo validation is pending.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(() => { store.close(); process.exit(0); }));
}
