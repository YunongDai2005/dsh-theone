import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { start } from './server.mjs';

test('Real Streamable HTTP: isolation, retry, correction, persistence and invalid requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'theone-mcp-'));
  const path = join(dir, 'topics.db');
  let instance = await start({ path });
  const client = new Client({ name: 'TheOne protocol verification', version: '0.1.0' });
  try {
    const raw = await fetch(instance.url, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' }
    } }) });
    assert.equal((await raw.json()).result.protocolVersion, '2025-11-25');
    await client.connect(new StreamableHTTPClientTransport(new URL(instance.url)));
    assert.equal((await client.listTools()).tools.length, 6);
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      if (r.isError) throw new Error(r.content[0].text);
      return JSON.parse(r.content[0].text);
    };
    const budget = await call('create_topic', { title: 'Household budget', summary: 'Expenses', keywords: ['budget'] });
    const move = await call('create_topic', { title: 'Apartment move', summary: 'Moving logistics', keywords: ['mover'] });
    const note = await call('save_note', { topicId: move.id, text: 'Moving bill: 480 EUR', requestKey: 'bill-1' });
    assert.equal((await call('read_topic', { topicId: budget.id })).notes.length, 0);
    const replay = await call('save_note', { topicId: move.id, text: 'Moving bill: 480 EUR', requestKey: 'bill-1' });
    assert.equal(replay.id, note.id); assert.equal(replay.replayed, true);
    await assert.rejects(call('save_note', { topicId: move.id, text: 'Different bill', requestKey: 'bill-1' }), /different content/);
    const corrected = await call('move_note', { noteId: note.id, destinationTopicId: budget.id, expectedVersion: 1 });
    assert.equal(corrected.version, 2);
    assert.equal((await call('read_topic', { topicId: move.id })).notes.length, 0);
    assert.equal((await call('read_topic', { topicId: budget.id })).notes[0].id, note.id);
    await assert.rejects(call('move_note', { noteId: note.id, destinationTopicId: move.id, expectedVersion: 1 }), /Stale/);
    await assert.rejects(call('save_note', { topicId: '00000000-0000-4000-8000-000000000000', text: 'Orphan', requestKey: 'missing' }), /Unknown/);
    const route = await call('suggest_route', { message: 'Household budget: add groceries' });
    assert.equal(route.decision.contextId, budget.id);
    assert.equal((await call('read_topic', { topicId: budget.id })).noteContentIsUntrusted, true);
    const origin = await fetch(instance.url, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
    assert.equal(origin.status, 403);
    // Node fetch normalizes Host, so use a real raw HTTP header for this check.
    const hostStatus = await new Promise((yes, no) => {
      const r = request(instance.url, { method: 'POST', headers: { Host: 'untrusted.example' } },
        res => { res.resume(); yes(res.statusCode); });
      r.on('error', no); r.end();
    });
    assert.equal(hostStatus, 403);
    await client.close(); await instance.close();
    instance = await start({ path });
    assert.equal(instance.memory.read(budget.id).notes[0].version, 2);
    assert.equal(instance.memory.read(move.id).notes.length, 0);
  } finally { await client.close(); await instance.close(); rmSync(dir, { recursive: true, force: true }); }
});
