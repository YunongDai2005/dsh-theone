// Local demonstration host: scripted user actions, real MCP calls, no LLM or Alexa device.
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { start } from './server.mjs';
import { readFile } from 'node:fs/promises';

const instance = await start({ path: process.env.THEONE_DEMO_DB || './.theone/demo-host.db' });
const client = new Client({ name: 'TheOne browser demo host', version: '0.1.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(instance.url)));
const events = [];
async function call(name, arguments_) {
  const response = await client.callTool({ name, arguments: arguments_ });
  const text = response.content[0].text;
  events.push({ tool: name, arguments: arguments_, result: text, error: !!response.isError });
  if (response.isError) throw new Error(text);
  return JSON.parse(text);
}
let topics = (await call('list_topics', {})).topics;
const findOrCreate = async (title, summary, keywords) => topics.find(t => t.title === title)
  || call('create_topic', { title, summary, keywords });
const move = await findOrCreate('Apartment move', 'Move logistics', ['mover', 'truck']);
const budget = await findOrCreate('Household budget', 'Monthly expenses', ['budget', 'groceries']);
events.length = 0;
let bill;
let busy = false;
const app = createMcpExpressApp({ host: '127.0.0.1' });
app.use((req, res, next) => {
  if (req.get('origin') && req.get('origin') !== `http://${req.get('host')}`) return res.sendStatus(403);
  next();
});
app.use(express.json({ limit: '2kb' }));
const html = await readFile(new URL('./demo-host.html', import.meta.url), 'utf8');
app.get('/', (_req, res) => res.type('html').send(html));
async function state() {
  const moving = await call('read_topic', { topicId: move.id });
  const budgeting = await call('read_topic', { topicId: budget.id });
  return { moving, budgeting, events: events.slice(-20), bill, endpoint: instance.url };
}
app.get('/api/state', async (_req, res) => {
  try { res.json(await state()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/action', async (req, res) => {
  if (busy) return res.status(409).json({ error: 'An action is already running.' });
  busy = true;
  try {
    const action = req.body.action;
    let message;
    if (action === 'save') {
      bill = await call('save_note', { topicId: move.id, text: 'Moving bill: 480 EUR', requestKey: 'demo-bill-480' });
      message = bill.replayed ? 'Existing save receipt returned without a duplicate.' : 'Saved the moving bill in Apartment move.';
    } else if (action === 'correct') {
      if (!bill) throw new Error('Save the bill first.');
      bill = await call('move_note', { noteId: bill.id, destinationTopicId: budget.id, expectedVersion: bill.version });
      message = 'Correction applied: this bill now belongs to Household budget.';
    } else if (action === 'retry') {
      bill = await call('save_note', { topicId: move.id, text: 'Moving bill: 480 EUR', requestKey: 'demo-bill-480' });
      message = 'Original save replayed: same note, current location, no duplicate.';
    } else if (action === 'stale') {
      if (!bill || bill.version < 2) throw new Error('Correct the bill first.');
      try {
        await call('move_note', { noteId: bill.id, destinationTopicId: move.id, expectedVersion: 1 });
        throw new Error('Unexpectedly accepted stale correction.');
      } catch (e) {
        if (e.message !== 'Stale note version; read the topic again') throw e;
        message = 'Stale correction refused: ' + e.message;
      }
    } else if (action === 'refresh') message = 'Read both topics through MCP.';
    else throw new Error('Unknown demonstration action.');
    res.json({ ...await state(), message });
  } catch (e) { res.status(400).json({ error: e.message }); }
  finally { busy = false; }
});
const listener = app.listen(Number(process.env.DEMO_PORT || 3036), '127.0.0.1', () => {
  console.log('TheOne demonstration host: http://127.0.0.1:' + listener.address().port);
  console.log('Scripted synthetic inputs; actual MCP HTTP client/server and persistent SQLite.');
});
async function close() {
  await new Promise(resolve => listener.close(resolve));
  await client.close(); await instance.close();
}
process.once('SIGINT', close); process.once('SIGTERM', close);
