// Offline tests. All model and PayPal responses below are mocks, not cloud evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvoiceWorkflow, money, validatePlan } from './workflow.mjs';
import { PayPalSandbox, ModelPlanner, SANDBOX } from './adapters.mjs';
import { createApp } from './server.mjs';

const topics = [
  { id: 'design', title: 'Design', summary: 'Website assets and invoices', recipient: 'design@example.invalid' },
  { id: 'move', title: 'Move', summary: 'Moving logistics', recipient: 'move@example.invalid' },
];
const plan = { intent: 'invoice_draft', topic_id: 'design', amount: '480', currency: 'EUR', description: 'Website assets', reply: 'Review this draft.' };
const planner = { async plan() { return { plan: structuredClone(plan), model: 'mock/offline' }; } };
function fakePayPal() {
  let payload, creates = 0, reads = 0;
  return {
    get creates() { return creates; }, get reads() { return reads; },
    async createDraft(value) { creates++; payload = structuredClone(value); return 'INV2-MOCK-ONLY'; },
    async getDraft(id) { reads++; return { ...structuredClone(payload), id, status: 'DRAFT', amount: structuredClone(payload.items[0].unit_amount) }; },
  };
}
function fixture(t, paypal = fakePayPal(), customPlanner = planner, database) {
  const app = new InvoiceWorkflow({ topics, planner: customPlanner, paypal, database });
  t.after(() => app.close()); return { app, paypal };
}

test('amount validation rejects rounding, zero, signed/scientific and excessive values', () => {
  assert.equal(money('0.1'), '0.10'); assert.equal(money('480'), '480.00');
  for (const value of ['0', '-1', '1.005', '1e3', '01', '10000.01', 12, null]) assert.throws(() => money(value));
});
test('untrusted model cannot insert API actions, recipients, topics or unsupported money', () => {
  for (const patch of [{ topic_id: 'unknown' }, { recipient: 'attacker@example.invalid' }, { intent: 'pay' },
    { currency: 'BTC' }, { amount: '1.001' }, { topic_id: null }]) assert.throws(() => validatePlan({ ...plan, ...patch }, topics));
  assert.throws(() => validatePlan({ ...plan, intent: 'chat' }, topics));
  assert.equal(validatePlan({ ...plan, reply: '' }, topics).amount, '480.00');
  assert.throws(() => validatePlan({ ...plan, intent: 'clarify', topic_id: null, amount: null, currency: null, description: null, reply: '' }, topics));
});
test('proposing and correcting a project does not call PayPal; old review cannot create', async t => {
  const { app, paypal } = fixture(t);
  const original = (await app.plan('Mock input')).proposal;
  const corrected = app.correct(original.id, original.revision, 'move');
  assert.equal(corrected.payload.primary_recipients[0].billing_info.email_address, 'move@example.invalid');
  assert.equal(app.proposals('design').length, 0); assert.equal(app.proposals('move').length, 1);
  assert.throws(() => app.correct(original.id, original.revision, 'design'), /Stale/);
  await assert.rejects(app.approve(original.id, original.digest), /Review changed/);
  assert.equal(paypal.creates, 0);
  const created = await app.approve(corrected.id, corrected.digest);
  assert.equal(created.state, 'CREATED'); assert.equal(paypal.creates, 1);
  assert.throws(() => app.correct(created.id, created.revision, 'design'), /immutable/);
});
test('concurrent/replayed approval and database restart do not duplicate a remote draft', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'theone-invoice-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paypal = fakePayPal(), db = join(dir, 'test.sqlite');
  let app = new InvoiceWorkflow({ topics, planner, paypal, database: db });
  const p = (await app.plan('Mock input')).proposal;
  const attempts = await Promise.allSettled([app.approve(p.id, p.digest), app.approve(p.id, p.digest)]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1); assert.equal(paypal.creates, 1);
  app.close(); app = new InvoiceWorkflow({ topics, planner, paypal, database: db }); t.after(() => app.close());
  assert.equal((await app.approve(p.id, p.digest)).state, 'CREATED'); assert.equal(paypal.creates, 1);
});
test('unknown POST outcome remains uncertain and never automatically creates again', async t => {
  let creates = 0;
  const { app } = fixture(t, { async createDraft() { creates++; throw Error('mock connection lost'); } });
  const p = (await app.plan('Mock input')).proposal;
  await assert.rejects(app.approve(p.id, p.digest), /could not be verified/);
  await assert.rejects(app.approve(p.id, p.digest), /uncertain/);
  await assert.rejects(app.reconcile(p.id), /No known remote ID/);
  assert.equal(creates, 1); assert.equal(app.proposals()[0].state, 'UNCERTAIN');
});
test('failed read after create preserves ID and supports read-only reconciliation', async t => {
  const paypal = fakePayPal(), read = paypal.getDraft; let failed = false;
  paypal.getDraft = async id => { if (!failed) { failed = true; throw Error('mock read timeout'); } return read(id); };
  const { app } = fixture(t, paypal); const p = (await app.plan('Mock input')).proposal;
  await assert.rejects(app.approve(p.id, p.digest));
  assert.equal(app.proposals()[0].remote_id, 'INV2-MOCK-ONLY');
  assert.equal((await app.reconcile(p.id)).state, 'CREATED'); assert.equal(paypal.creates, 1);
});
test('remote recipient/amount mismatch cannot be reported as successful', async t => {
  const paypal = fakePayPal(), read = paypal.getDraft;
  paypal.getDraft = async id => ({ ...await read(id), amount: { currency_code: 'EUR', value: '481.00' } });
  const { app } = fixture(t, paypal); const p = (await app.plan('Mock input')).proposal;
  await assert.rejects(app.approve(p.id, p.digest)); assert.equal(app.proposals()[0].state, 'UNCERTAIN');
});
test('notes-only topic refuses invoice creation and project correction', async t => {
  const catalog = [...topics, { id: 'budget', title: 'Budget', summary: 'Personal expense notes', recipient: 'none@example.invalid', invoice_enabled: false }];
  const paypal = fakePayPal(); let selected = 'budget';
  const app = new InvoiceWorkflow({ topics: catalog, paypal, planner: { async plan() {
    return { plan: { ...plan, topic_id: selected }, model: 'mock/offline' };
  } } }); t.after(() => app.close());
  await assert.rejects(app.plan('Mock input'), /not customer invoices/);
  selected = 'design'; const p = (await app.plan('Mock input')).proposal;
  assert.throws(() => app.correct(p.id, p.revision, 'budget'), /not customer invoices/);
  assert.equal(paypal.creates, 0);
});
test('PayPal adapter uses only fixed Sandbox OAuth/create/read paths and never follows live links', async () => {
  const calls = [];
  const client = new PayPalSandbox({ clientId: 'mock-id', clientSecret: 'mock-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const data = url.endsWith('/token') ? { access_token: 'mock-token', expires_in: 3600 }
      : options.method === 'POST' ? { id: 'INV2-MOCK-ONLY' } : { id: 'INV2-MOCK-ONLY', status: 'DRAFT' };
    return new Response(JSON.stringify(data), { status: 200 });
  } });
  assert.equal(await client.createDraft({ items: [] }), 'INV2-MOCK-ONLY'); await client.getDraft('INV2-MOCK-ONLY');
  assert.deepEqual(calls.map(c => c.url), [`${SANDBOX}/v1/oauth2/token`, `${SANDBOX}/v2/invoicing/invoices`, `${SANDBOX}/v2/invoicing/invoices/INV2-MOCK-ONLY`]);
  assert.ok(calls.every(c => c.options.redirect === 'error'));
  const bad = new PayPalSandbox({ clientId: 'mock-id', clientSecret: 'mock-secret', fetchImpl: async url => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: 'mock', expires_in: 3600 } : { href: 'https://api-m.paypal.com/v2/invoicing/invoices/INV2-LIVE' })) });
  await assert.rejects(bad.createDraft({}), /No verifiable Sandbox invoice/);
  await assert.rejects(client.getDraft('INV2-X/send'), /Invalid invoice/);
});
test('model call sends topic descriptions without configured recipient addresses', async () => {
  let sent;
  const model = new ModelPlanner({ baseUrl: 'https://model.example.invalid/v1', apiKey: 'mock', model: 'mock/offline', fetchImpl: async (_url, options) => {
    sent = options.body; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  } });
  await model.plan('Mock input', topics); assert.ok(!sent.includes('design@example.invalid')); assert.ok(sent.includes('Website assets'));
  assert.throws(() => new ModelPlanner({ baseUrl: 'http://model.example.invalid', apiKey: 'mock', model: 'mock' }), /HTTPS/);
});
test('actual local HTTP server denies foreign origins, requires session token and produces valid nonce HTML', async t => {
  const server = createApp({ topics, planner, paypal: fakePayPal() });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(url); const html = await response.text();
  assert.ok(!html.includes('__TOKEN__')); const token = /const token='([a-f0-9]+)'/.exec(html)[1];
  assert.ok(response.headers.get('content-security-policy').includes(`nonce-${token}`));
  assert.equal((await fetch(url + '/state')).status, 403);
  assert.equal((await fetch(url + '/state', { headers: { 'X-TheOne-Token': token, Origin: 'https://attacker.example' } })).status, 403);
  const headers = { 'X-TheOne-Token': token, 'Content-Type': 'application/json' };
  const proposal = await (await fetch(url + '/plan', { method: 'POST', headers, body: JSON.stringify({ message: 'Mock input' }) })).json();
  assert.equal(proposal.proposal.state, 'REVIEW');
  const created = await (await fetch(url + '/approve', { method: 'POST', headers, body: JSON.stringify({ id: proposal.proposal.id, digest: proposal.proposal.digest }) })).json();
  assert.equal(created.state, 'CREATED'); assert.equal(created.remote_id, 'INV2-MOCK-ONLY');
});
