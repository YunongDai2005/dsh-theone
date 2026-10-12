import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTopicMcp } from '../server.mjs';
import { scopedAction } from '../../../dist/armoriq.js';

const token = 'synthetic-test-token-never-use-as-a-real-secret';
async function setup(t, limit = 20) {
  const directory = await mkdtemp(join(tmpdir(), 'theone-mcp-')), databasePath = join(directory, 'notes.db');
  const server = createTopicMcp({ databasePath, topic: 'demo-travel', bearerToken: token, maxRequests: limit });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => { await new Promise(resolve => server.close(resolve)); };
  t.after(async () => { if (server.listening) await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = async (message, headers = {}) => fetch(`${base}/mcp`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(message) });
  const rpc = async (method, params) => {
    const response = await request({ jsonrpc: '2.0', id: 1, method, params });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const sse = await response.text(); assert.ok(sse.endsWith('\n\n')); return JSON.parse(sse.match(/^data: (.*)$/m)[1]);
  };
  return { rpc, request, stop, databasePath, base };
}

test('HTTP/SSE handshake, discovery and actual scoped SQLite notes persist after close', async t => {
  const app = await setup(t);
  assert.equal((await app.rpc('initialize', {})).result.serverInfo.name, 'theone-notes');
  const tools = (await app.rpc('tools/list', {})).result.tools;
  assert.deepEqual(tools.map(t => t.name), [scopedAction('demo-travel', 'read'), scopedAction('demo-travel', 'write')]);
  const call = (operation, args) => app.rpc('tools/call', { name: scopedAction('demo-travel', operation), arguments: args });
  assert.deepEqual(JSON.parse((await call('write', { key: 'plan', text: 'Synthetic trip note' })).result.content[0].text), { saved: true, key: 'plan' });
  assert.deepEqual(JSON.parse((await call('read', { key: 'plan' })).result.content[0].text), { found: true, text: 'Synthetic trip note' });
  await app.stop();
  const db = new DatabaseSync(app.databasePath);
  try { assert.equal(db.prepare('SELECT text FROM notes WHERE topic=? AND key=?').get('demo-travel', 'plan').text, 'Synthetic trip note'); } finally { db.close(); }
});

test('authentication, browser origin, other topics and invented operations cannot access notes', async t => {
  const app = await setup(t);
  const message = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await app.request(message, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await app.request(message, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await app.rpc('tools/call', { name: scopedAction('demo-finance', 'read'), arguments: { key: 'plan' } })).error.code, -32602);
  assert.equal((await app.rpc('tools/call', { name: scopedAction('demo-travel', 'write'), arguments: { key: 'plan', text: 'Wrong scope', topicId: 'demo-finance' } })).error.code, -32602);
  assert.equal((await app.rpc('tools/call', { name: 'terminal', arguments: { command: 'anything' } })).error.code, -32602);
  assert.deepEqual(JSON.parse((await app.rpc('tools/call', { name: scopedAction('demo-travel', 'read'), arguments: { key: 'plan' } })).result.content[0].text), { found: false });
});

test('invalid notifications cannot write and hard request limits stop further work', async t => {
  const app = await setup(t, 2);
  assert.equal((await app.request({ jsonrpc: '2.0', method: 'tools/call', params: { name: scopedAction('demo-travel', 'write'), arguments: { key: 'plan', text: 'No id' } } })).status, 400);
  assert.deepEqual(JSON.parse((await app.rpc('tools/call', { name: scopedAction('demo-travel', 'read'), arguments: { key: 'plan' } })).result.content[0].text), { found: false });
  assert.equal((await app.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status, 429);
});
