import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { connect, Memory, InputError, text } from './memory.mjs';
import { Planner } from './agent.mjs';

export async function createApp({db, planner = new Planner(), secret, port = 3060} = {}) {
  if (!secret) throw new Error('Session signing secret required');
  const proposals = new Map();
  const sign = sid => createHmac('sha256', secret).update(sid).digest('hex');
  const page = await readFile(new URL('./web.html', import.meta.url));
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, data) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data)); };
    try {
      const host = req.headers.host;
      if (!['127.0.0.1', 'localhost'].some(h => host === `${h}:${port}`)) throw new InputError('Loopback host required', 403);
      if (req.method === 'POST' && req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) throw new InputError('Cross-origin request rejected', 403);
      if (req.method === 'GET' && req.url === '/') { res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); return res.end(page); }
      let sid;
      const match = req.headers.cookie?.match(/(?:^|;\s*)memory=([0-9a-f-]{36})\.([0-9a-f]{64})(?:;|$)/);
      if (match && timingSafeEqual(Buffer.from(sign(match[1])), Buffer.from(match[2]))) sid = match[1];
      else { sid = randomUUID(); res.setHeader('Set-Cookie', `memory=${sid}.${sign(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`); }
      const namespace = 'theone_' + sign(sid).slice(0, 40);
      const m = new Memory(db, namespace); await m.init();
      if (req.method === 'GET' && req.url === '/api/topics') return json(200, {topics: await m.topics(), modelCalls: planner.calls, modelLimit: planner.limit});
      if (req.method !== 'POST' || !req.url.startsWith('/api/')) throw new InputError('Not found', 404);
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 24000) throw new InputError('Body too large', 413); }
      if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('JSON required');
      let b; try { b = JSON.parse(raw); } catch { throw new InputError('Invalid JSON'); }
      if (!b || Array.isArray(b) || typeof b !== 'object') throw new InputError('Object required');
      // Graph decisions are authoritative; no user-supplied namespace or arbitrary query route.
      if (req.url === '/api/topic') return json(200, await m.createTopic(b.title));
      if (req.url === '/api/context') return json(200, {facts: await m.context(b.topic)});
      if (req.url === '/api/history') return json(200, {history: await m.history(b.topic, b.id)});
      if (req.url === '/api/share' || req.url === '/api/revoke') {
        if (b.confirmed !== true) throw new InputError('Explicit sharing confirmation required');
        return json(200, {affected: await m[req.url === '/api/share' ? 'share' : 'revoke'](b.owner, b.id, b.target)});
      }
      if (req.url === '/api/chat') {
        const message = text(b.message, 2000); const plan = await planner.plan(message, await m.topics());
        const context = plan.topicId ? await m.context(plan.topicId) : [];
        if (plan.operation === 'recall') return json(200, {plan, context, trace: 'Topic -USES-> Fact -CURRENT-> Assertion -SUPPORTED_BY-> Evidence'});
        const existing = context.find(f => f.ownerId === plan.topicId && f.key === plan.key);
        if ((plan.operation === 'remember' && existing) || (plan.operation === 'revise' && !existing)) throw new InputError('Proposal conflicts with current graph; use the fact controls to correct it', 409);
        const token = randomUUID();
        for (const [k, v] of proposals) if (v.expires < Date.now()) proposals.delete(k);
        if (proposals.size >= 100) throw new InputError('Pending proposal limit', 429);
        proposals.set(token, {sid, plan, message, existing, expires: Date.now() + 300000});
        return json(200, {plan, context, token, expectedRevision: existing?.revision, needsConfirmation: true});
      }
      if (req.url === '/api/confirm') {
        const p = proposals.get(b.token);
        if (!p || p.sid !== sid || p.expires < Date.now()) throw new InputError('Proposal expired or belongs to another workspace', 404);
        if (b.confirmed !== true) throw new InputError('Confirmation required');
        proposals.delete(b.token); // one-shot, including failure; graph revision prevents stale writes
        const topic = p.plan.topicId || (await m.createTopic(p.plan.newTitle)).id;
        const fact = p.existing ? await m.revise(topic, p.existing.id, p.existing.revision, p.plan.value, p.message) : await m.remember(topic, p.plan.key, p.plan.value, p.message);
        return json(200, {topic, fact, context: await m.context(topic)});
      }
      if (req.url === '/api/fact') {
        if (b.confirmed !== true) throw new InputError('Explicit fact confirmation required');
        const fact = b.id ? await m.revise(b.topic, b.id, b.expected, b.value, b.evidence) : await m.remember(b.topic, b.key, b.value, b.evidence);
        return json(200, {fact, context: await m.context(b.topic)});
      }
      throw new InputError('Not found', 404);
    } catch (error) {
      if (error instanceof InputError) json(error.status, {error: error.message});
      else json(503, {error: 'Graph or upstream unavailable; request failed. No fallback context is fabricated.'});
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let secret;
  const file = new URL('./.session-secret', import.meta.url);
  try { secret = await readFile(file, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const candidate = randomUUID() + randomUUID();
    try { await writeFile(file, candidate, {mode: 0o600, flag: 'wx'}); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    secret = await readFile(file, 'utf8');
  }
  const db = await connect(); const port = Number(process.env.PORT || 3060);
  const server = await createApp({db, secret, port});
  server.listen(port, '127.0.0.1', () => console.log(`Synthetic graph memory: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => {
    try {await db.close();} catch { /* already disconnected after a graph outage */ }
    process.exit(0);
  }));
}
