import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scopedAction } from '../../dist/armoriq.js';

// A real, single-topic notes endpoint for registry discovery. This transport
// does not mint tokens or replace the DSH pre-execution ArmorIQ check.
export function createTopicMcp({ databasePath, topic, bearerToken, maxRequests = 200 }) {
  if (!databasePath || !isAbsolute(databasePath)) throw new Error('Use an absolute path to a synthetic demo database.');
  if (typeof topic !== 'string' || !topic.length || topic.length > 160) throw new Error('Configure one operator-owned topic.');
  if (typeof bearerToken !== 'string' || bearerToken.length < 32 || bearerToken.length > 256 || /\s/.test(bearerToken)) throw new Error('Configure a private bearer token of at least 32 characters.');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new Error('Request limit must be 1–1000.');
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE IF NOT EXISTS notes (topic TEXT, key TEXT, text TEXT NOT NULL, PRIMARY KEY(topic, key));');
  const actions = new Map(['read', 'write'].map(operation => [scopedAction(topic, operation), operation]));
  const tools = [...actions].map(([name, operation]) => ({ name,
    description: `${operation === 'read' ? 'Read' : 'Write'} a note in the operator-configured synthetic topic. No topic argument is accepted.`,
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { key: { type: 'string', minLength: 1, maxLength: 100 },
        ...(operation === 'write' ? { text: { type: 'string', maxLength: 20000 } } : {}) },
      required: operation === 'write' ? ['key', 'text'] : ['key'] } }));
  const expectedAuth = Buffer.from(`Bearer ${bearerToken}`);
  let requests = 0, closed = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reject = status => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Request rejected.' })); };
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'TheOne synthetic topic MCP', cloudEnforcementVerified: false })); return;
    }
    if (req.url !== '/mcp') return reject(404);
    if (req.method !== 'POST') return reject(405);
    const actualAuth = Buffer.from(req.headers.authorization ?? '');
    if (actualAuth.length !== expectedAuth.length || !timingSafeEqual(actualAuth, expectedAuth)) return reject(401);
    // This endpoint is for authenticated server-to-server calls, not browser JS.
    if (req.headers.origin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return reject(403);
    if (requests >= maxRequests) return reject(429);
    requests++;
    let message;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 96 * 1024) { reject(413); return; }
        chunks.push(chunk);
      }
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { if (!res.writableEnded) reject(400); return; }
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return reject(400);
    if (message.method === 'notifications/initialized' && !Object.hasOwn(message, 'id')) { res.writeHead(202); res.end(); return; }
    if (typeof message.id !== 'string' && (typeof message.id !== 'number' || !Number.isFinite(message.id))) return reject(400);
    let result, error;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'theone-notes', version: '0.1.0' } };
    else if (message.method === 'tools/list') result = { tools };
    else if (message.method === 'tools/call') {
      const operation = actions.get(message.params?.name), args = message.params?.arguments;
      const keys = args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args) : [];
      const valid = operation && args && !Array.isArray(args) && typeof args.key === 'string' && args.key.length > 0 && args.key.length <= 100 &&
        keys.every(key => key === 'key' || (operation === 'write' && key === 'text')) &&
        (operation !== 'write' || (typeof args.text === 'string' && args.text.length <= 20000));
      if (!valid) error = { code: -32602, message: 'Unknown scoped action or invalid note arguments.' };
      else {
        try {
          let value;
          if (operation === 'write') {
            db.prepare('INSERT INTO notes(topic,key,text) VALUES (?,?,?) ON CONFLICT(topic,key) DO UPDATE SET text=excluded.text').run(topic, args.key, args.text);
            value = { saved: true, key: args.key };
          } else {
            const row = db.prepare('SELECT text FROM notes WHERE topic=? AND key=?').get(topic, args.key);
            value = row ? { found: true, text: String(row.text) } : { found: false };
          }
          result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
        } catch { result = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Note operation unavailable.' }) }] }; }
      }
    } else error = { code: -32601, message: 'Method not available.' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(error ? { error } : { result }) })}\n\n`);
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000;
  server.on('close', () => { if (!closed) { closed = true; db.close(); } });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createTopicMcp({ databasePath: process.env.THEONE_MCP_DATABASE_PATH,
    topic: process.env.THEONE_MCP_TOPIC, bearerToken: process.env.THEONE_MCP_BEARER_TOKEN });
  server.listen(3059, '127.0.0.1', () => console.log('Synthetic notes MCP listening on loopback port 3059. Cloud registration/enforcement pending.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
