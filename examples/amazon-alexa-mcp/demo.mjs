// An actual MCP host scripted for reproducibility; this is NOT a language model or Alexa device.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { start } from './server.mjs';

const instance = await start();
const client = new Client({ name: 'TheOne scripted host demonstration', version: '0.1.0' });
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(instance.url)));
  const budget = await call('create_topic', { title: 'Household budget', summary: 'Monthly expenses', keywords: ['budget', 'groceries'] });
  const move = await call('create_topic', { title: 'Apartment move', summary: 'Move logistics', keywords: ['mover', 'truck'] });
  const bill = await call('save_note', { topicId: move.id, text: 'Moving bill: 480 EUR', requestKey: 'bill-480' });
  console.log('Moving notes:', (await call('read_topic', { topicId: move.id })).notes);
  console.log('Budget notes before correction:', (await call('read_topic', { topicId: budget.id })).notes);
  console.log('User correction: this is a monthly budget expense, not moving logistics.');
  console.log('Correction receipt:', await call('move_note', { noteId: bill.id, destinationTopicId: budget.id, expectedVersion: 1 }));
  console.log('Retry original save:', await call('save_note', { topicId: move.id, text: 'Moving bill: 480 EUR', requestKey: 'bill-480' }));
  console.log('Moving notes after correction:', (await call('read_topic', { topicId: move.id })).notes);
  console.log('Budget notes after correction:', (await call('read_topic', { topicId: budget.id })).notes);
} finally { await client.close(); await instance.close(); }
