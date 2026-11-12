// All remote responses are fakes. These tests establish behavior, not live integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { InvoiceWorkflow } from './workflow.mjs';
import { previewPlanner, previewTopics, previewPayPal } from './preview.mjs';
import { PayPalSandbox, ModelPlanner, SANDBOX } from './adapters.mjs';
import { createApp } from './server.mjs';

const draft = 'Draft a 480 EUR invoice for the design client for website assets.';
function fixture(t, overrides = {}) {
  const options = { topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), ...overrides };
  const app = new InvoiceWorkflow(options);
  t.after(() => app.close());
  return app;
}
function database(t) {
  const dir = mkdtempSync(join(tmpdir(), 'one-backend-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'desk.sqlite');
}
function edit(p, amount = '520') {
  return { intent: 'invoice_update', topic_id: p.topic_id, proposal_id: p.id, revision: p.revision,
    amount, currency: 'EUR', description: null, reply: 'Updated for review.' };
}

test('conversation revisions preserve one invoice and provide versioned review diffs', async t => {
  const app = fixture(t);
  const original = (await app.plan(draft)).proposal;
  const updated = (await app.plan('Actually, make it 520 EUR.')).proposal;
  assert.equal(updated.id, original.id);
  assert.equal(updated.revision, 2);
  assert.equal(updated.payload.items[0].unit_amount.value, '520.00');
  assert.equal(updated.payload.items[0].name, 'Website design assets');
  assert.equal(updated.payload.primary_recipients[0].billing_info.email_address, 'design-buyer@example.invalid');
  assert.equal(app.proposals().length, 1);
  assert.equal(updated.state, 'REVIEW');
  assert.deepEqual(app.review(updated.id).changes, [{ field: 'amount', before: '480.00', after: '520.00' }]);
  const history = app.history(updated.id);
  assert.deepEqual(history.versions.map(v => v.cause), ['proposed', 'conversation_revision']);
  assert.equal(history.versions[1].source_message_ids[0], app.messages().at(-2).id);
  await assert.rejects(app.approve(original.id, original.digest), /Review changed/);
  assert.equal((await app.approve(updated.id, updated.digest)).state, 'CREATED');
  assert.deepEqual(app.history(updated.id).events.slice(-3).map(e => e.kind), ['creation_requested', 'remote_identified', 'remote_verified']);
});

test('reverting an amount does not revive an old approval digest', async t => {
  const app = fixture(t), p = (await app.plan(draft)).proposal;
  const second = app.revise(p.id, 1, { amount: '520' });
  const third = app.revise(p.id, 2, { amount: '480' });
  assert.deepEqual(third.payload, p.payload);
  assert.notEqual(third.digest, p.digest);
  assert.notEqual(third.digest, second.digest);
  await assert.rejects(app.approve(p.id, p.digest), /Review changed/);
});

test('manual revisions reject unsupported fields, stale versions and no-ops atomically', async t => {
  const app = fixture(t), p = (await app.plan(draft)).proposal;
  for (const changes of [{ recipient: 'elsewhere@example.invalid' }, { amount: '1.001' }, { currency: 'BTC' },
    { amount: '480' }, { description: '' }, {}, null, []]) assert.throws(() => app.revise(p.id, 1, changes));
  assert.equal(app.history(p.id).versions.length, 1);
  const updated = app.revise(p.id, 1, { currency: 'USD', description: 'Design consultation' });
  assert.equal(updated.payload.detail.currency_code, 'USD');
  assert.equal(updated.payload.items[0].unit_amount.currency_code, 'USD');
  assert.equal(updated.payload.items[0].name, 'Design consultation');
  assert.throws(() => app.revise(p.id, 1, { amount: '600' }), /Stale/);
});

test('server disambiguates multiple editable drafts even when the model guesses', async t => {
  let forced;
  const planner = { ...previewPlanner, async plan(...args) {
    return forced ? { model: 'mock', plan: forced } : previewPlanner.plan(...args);
  } };
  const app = fixture(t, { planner }), p = (await app.plan(draft)).proposal;
  await app.plan('Draft a 120 EUR invoice for the design client for project services.');
  forced = edit(p);
  const unclear = await app.plan('Make it 520 EUR.');
  assert.equal(unclear.plan.intent, 'clarify');
  assert.match(unclear.plan.reply, new RegExp(p.payload.detail.invoice_number));
  assert.equal(app.history(p.id).versions.length, 1);
  const result = await app.plan(`Change ${p.payload.detail.invoice_number} to 520 EUR.`);
  assert.equal(result.proposal.id, p.id);
  assert.equal(result.proposal.revision, 2);
});

test('revision target cannot cross project boundaries or mutate an already created draft', async t => {
  let forced;
  const planner = { ...previewPlanner, async plan(...args) { return forced ? { model: 'mock', plan: forced } : previewPlanner.plan(...args); } };
  const app = fixture(t, { planner }), p = (await app.plan(draft)).proposal;
  forced = { ...edit(p), topic_id: 'move' };
  const before = app.messages().length;
  await assert.rejects(app.plan('Change the moving project invoice to 520 EUR.'), /Revision target/);
  assert.equal(app.messages().length, before);
  forced = undefined;
  await app.approve(p.id, p.digest);
  forced = edit(p);
  await assert.rejects(app.plan('Change the design invoice to 520 EUR.'), /Revision target/);
  assert.throws(() => app.revise(p.id, 1, { amount: '520' }), /immutable/);
});

test('an approval started during inference prevents a stale conversational edit', async t => {
  let release, entered, editing = false;
  const started = new Promise(r => { entered = r; });
  const planner = { ...previewPlanner, async plan(...args) {
    const result = await previewPlanner.plan(...args);
    if (editing) { entered(); await new Promise(r => { release = r; }); }
    return result;
  } };
  const app = fixture(t, { planner }), p = (await app.plan(draft)).proposal;
  editing = true;
  const pending = app.plan('Make it 520 EUR.');
  await started; await app.approve(p.id, p.digest); release();
  await assert.rejects(pending, /Stale review/);
  assert.equal(app.messages().length, 2);
  assert.equal(app.history(p.id).versions.length, 1);
});

test('project correction moves the original conversation and its revision exchanges', async t => {
  let context;
  const planner = { ...previewPlanner, async route(message, topics, ctx) { context = ctx; return previewPlanner.route(message, topics, ctx); } };
  const app = fixture(t, { planner }), p = (await app.plan(draft)).proposal;
  await app.plan('Make it 520 EUR.');
  const updated = app.correct(p.id, 2, 'move');
  assert.equal(app.messages('move').length, 4);
  assert.equal(app.messages('design').length, 0);
  assert.equal(app.routingState().currentId, 'move');
  assert.equal(updated.payload.items[0].unit_amount.value, '520.00');
  assert.deepEqual(app.review(p.id).changes.map(c => c.field), ['project', 'recipient']);
  await app.plan('Continue with Moving project.');
  assert.equal(context.corrections.at(-1).text, draft + '\nMake it 520 EUR.');
});

test('request IDs prevent duplicate inference and proposals across concurrency and restart', async t => {
  const db = database(t); let calls = 0;
  const planner = { ...previewPlanner, async route(...args) { calls++; return previewPlanner.route(...args); } };
  let app = new InvoiceWorkflow({ topics: previewTopics, planner, paypal: previewPayPal(), database: db });
  const results = await Promise.all([app.plan(draft, 'invoice-request-001'), app.plan(draft, 'invoice-request-001')]);
  assert.equal(results[0].proposal.id, results[1].proposal.id);
  assert.equal(results[1].replayed, true);
  assert.equal(calls, 1);
  app.close(); app = new InvoiceWorkflow({ topics: previewTopics, planner, paypal: previewPayPal(), database: db });
  t.after(() => app.close());
  assert.equal((await app.plan(draft, 'invoice-request-001')).replayed, true);
  await assert.rejects(app.plan('Different request', 'invoice-request-001'), /different message/);
  assert.equal(calls, 1); assert.equal(app.messages().length, 2); assert.equal(app.proposals().length, 1);
});

test('failed planning does not claim an idempotency key or leave a partial journal', async t => {
  let fail = true;
  const planner = { ...previewPlanner, async plan(...args) { if (fail) throw Error('mock provider unavailable'); return previewPlanner.plan(...args); } };
  const app = fixture(t, { planner });
  await assert.rejects(app.plan(draft, 'recoverable-key'), /unavailable/);
  assert.equal(app.proposals().length, 0); assert.equal(app.messages().length, 0);
  fail = false; const result = await app.plan(draft, 'recoverable-key');
  assert.equal(result.proposal.state, 'REVIEW'); assert.equal(app.history(result.proposal.id).events.length, 1);
});

test('model revision context is bounded to this project and excludes recipients and arbitrary fields', async () => {
  let body;
  const planner = new ModelPlanner({ baseUrl: 'https://model.example.invalid/v1', apiKey: 'mock', model: 'mock', fetchImpl: async (_, options) => {
    body = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: JSON.stringify({ intent: 'chat', topic_id: 'design', amount: null, currency: null, description: null, reply: 'Noted.' }) } }] });
  } });
  await planner.plan('Make it 520 EUR.', previewTopics, { topicId: 'design', drafts: [{ id: 'local-draft', revision: 2,
    invoice_number: 'TO-01234567890123456789', amount: '480.00', currency: 'EUR', description: 'Assets', recipient: 'private@example.invalid', payload: { unsafe: true } }] });
  const input = JSON.parse(body.messages[1].content);
  assert.deepEqual(input.catalog.map(t => t.id), ['design']);
  assert.equal(input.drafts[0].revision, 2);
  assert.ok(!JSON.stringify(body).includes('@example.invalid'));
  assert.ok(!('payload' in input.drafts[0]));
  assert.match(body.messages[0].content, /invoice_update/);
});

function lostResponsePayPal() {
  const base = previewPayPal(); let creates = 0, searches = 0;
  return { get creates() { return creates; }, get searches() { return searches; },
    async createDraft(payload) { creates++; await base.createDraft(payload); throw Error('mock response lost after creation'); },
    getDraft: base.getDraft,
    async findDraftByInvoiceNumber(number) { searches++; return base.findDraftByInvoiceNumber(number); } };
}

test('unknown remote ID can be recovered after restart with search and read, without another create', async t => {
  const db = database(t), paypal = lostResponsePayPal();
  let app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal, database: db });
  const p = (await app.plan(draft)).proposal;
  await assert.rejects(app.approve(p.id, p.digest));
  assert.equal(app.proposals()[0].remote_id, null);
  app.close(); app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal, database: db }); t.after(() => app.close());
  const recovered = await app.reconcile(p.id);
  assert.equal(recovered.state, 'CREATED'); assert.equal(paypal.creates, 1); assert.equal(paypal.searches, 1);
  assert.ok(app.history(p.id).events.some(e => e.kind === 'remote_recovered'));
  assert.equal(app.history(p.id).events.at(-1).kind, 'remote_verified');
});

test('empty or ambiguous recovery leaves the operation uncertain and cannot authorize retry-create', async t => {
  let creates = 0, ambiguous = false;
  const paypal = { async createDraft() { creates++; throw Error('lost'); },
    async findDraftByInvoiceNumber() { if (ambiguous) throw Error('Multiple invoices match'); return null; } };
  const app = fixture(t, { paypal }), p = (await app.plan(draft)).proposal;
  await assert.rejects(app.approve(p.id, p.digest));
  await assert.rejects(app.reconcile(p.id), /No matching invoice/);
  ambiguous = true; await assert.rejects(app.reconcile(p.id), /Multiple invoices/);
  await assert.rejects(app.approve(p.id, p.digest), /uncertain/);
  assert.equal(creates, 1); assert.equal(app.proposals()[0].remote_id, null);
  assert.equal(app.proposals()[0].state, 'UNCERTAIN');
});

test('recovery verifies the exact recipient and invoice fields before reporting success', async t => {
  const paypal = lostResponsePayPal(), get = paypal.getDraft;
  paypal.getDraft = async id => { const data = await get(id); data.primary_recipients = [{ billing_info: { email_address: 'wrong@example.invalid' } }]; return data; };
  const app = fixture(t, { paypal }), p = (await app.plan(draft)).proposal;
  await assert.rejects(app.approve(p.id, p.digest));
  await assert.rejects(app.reconcile(p.id), /does not match/);
  assert.equal(app.proposals()[0].state, 'UNCERTAIN');
  assert.ok(!app.history(p.id).events.some(e => e.kind === 'remote_verified'));
});

test('concurrent recovery shares one lookup', async t => {
  const paypal = lostResponsePayPal(), lookup = paypal.findDraftByInvoiceNumber;
  let release, entered;
  const started = new Promise(r => { entered = r; });
  paypal.findDraftByInvoiceNumber = async number => { entered(); await new Promise(r => { release = r; }); return lookup(number); };
  const app = fixture(t, { paypal }), p = (await app.plan(draft)).proposal;
  await assert.rejects(app.approve(p.id, p.digest));
  const first = app.reconcile(p.id); await started; const second = app.reconcile(p.id); release();
  assert.equal((await first).remote_id, (await second).remote_id);
  assert.equal(paypal.searches, 1);
  assert.equal(app.history(p.id).events.filter(e => e.kind === 'remote_verified').length, 1);
});

test('reconciliation cannot overlap an active creation or mark it uncertain', async t => {
  const base = previewPayPal(); let release, entered, searches = 0;
  const started = new Promise(r => { entered = r; });
  const paypal = { ...base, async createDraft(payload) { entered(); await new Promise(r => { release = r; }); return base.createDraft(payload); },
    async findDraftByInvoiceNumber() { searches++; return null; } };
  const app = fixture(t, { paypal }), p = (await app.plan(draft)).proposal;
  const creating = app.approve(p.id, p.digest); await started;
  await assert.rejects(app.reconcile(p.id), /still in progress/);
  assert.equal(app.proposals()[0].state, 'CREATING'); assert.equal(searches, 0);
  release(); assert.equal((await creating).state, 'CREATED');
});

test('workflow independently rejects a mismatched remote ID or non-draft status', async t => {
  for (const patch of [{ id: 'INV2-OTHER' }, { status: 'SENT' }, { additional_recipients: ['extra@example.invalid'] }]) {
    const paypal = previewPayPal(), read = paypal.getDraft;
    paypal.getDraft = async id => ({ ...await read(id), ...patch });
    const app = fixture(t, { paypal }), p = (await app.plan(draft)).proposal;
    await assert.rejects(app.approve(p.id, p.digest), /could not be verified/);
    assert.equal(app.proposals()[0].state, 'UNCERTAIN');
  }
});

test('project brief calculates revised totals by currency without implying paid or sent invoices', async t => {
  const app = fixture(t), p = (await app.plan(draft)).proposal;
  app.revise(p.id, 1, { amount: '520' });
  await app.plan('Draft a 25 USD invoice for the design client for project services.');
  await app.plan('Draft a 15 EUR invoice for the moving project for project services.');
  const brief = app.brief('design');
  assert.deepEqual(brief.awaiting_review, { count: 2, totals: [{ currency: 'EUR', amount: '520.00' }, { currency: 'USD', amount: '25.00' }] });
  assert.equal(brief.verified_drafts.count, 0);
  assert.match(brief.note, /not a live balance/);
  assert.match(app.brief('budget').text, /Notes only/);
  assert.throws(() => app.brief('unknown'), /Unknown topic/);
});

test('invoice status answers replace model-invented totals with database records', async t => {
  let answerStatus = false;
  const planner = { ...previewPlanner, async plan(...args) { return answerStatus ? { model: 'mock', plan: {
    intent: 'invoice_status', topic_id: 'design', amount: null, currency: null, description: null,
    reply: 'You were paid 9000 EUR.' } } : previewPlanner.plan(...args); } };
  const app = fixture(t, { planner }); await app.plan(draft); answerStatus = true;
  const result = await app.plan('What is the invoice status for design?');
  assert.match(result.plan.reply, /Awaiting review: 1 \(480.00 EUR\)/);
  assert.ok(!result.plan.reply.includes('9000'));
  assert.equal(app.proposals().length, 1);
});

test('a process interrupted in CREATING can reconcile without issuing a new create', async t => {
  const db = database(t), paypal = previewPayPal();
  let app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal, database: db });
  const p = (await app.plan(draft)).proposal;
  await paypal.createDraft(p.payload); app.close();
  const raw = new DatabaseSync(db); raw.prepare("UPDATE proposals SET state='CREATING' WHERE id=?").run(p.id); raw.close();
  app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal, database: db }); t.after(() => app.close());
  assert.equal((await app.reconcile(p.id)).state, 'CREATED');
});

test('legacy migration snapshots only the current version and remains idempotent', async t => {
  const db = database(t); let app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), database: db });
  const p = (await app.plan(draft)).proposal; app.revise(p.id, 1, { amount: '520' }); app.close();
  const raw = new DatabaseSync(db); raw.exec('DROP TABLE invoice_versions; DROP TABLE invoice_events; DROP TABLE plan_requests;'); raw.close();
  app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), database: db });
  assert.deepEqual(app.history(p.id).versions.map(v => [v.revision, v.cause]), [[2, 'legacy_snapshot']]); app.close();
  app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), database: db }); t.after(() => app.close());
  assert.equal(app.history(p.id).versions.length, 1); assert.equal(app.history(p.id).events.length, 1);
});

test('PayPal recovery uses a bounded exact-number search and never follows response URLs', async () => {
  const number = 'TO-01234567890123456789', calls = [];
  const client = new PayPalSandbox({ clientId: 'mock', clientSecret: 'mock', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return Response.json({ access_token: 'mock', expires_in: 3600 });
    if (url.includes('page=1&')) return Response.json({ total_pages: 2, items: [{ id: 'INV2-UNRELATED', detail: { invoice_number: 'OTHER' } }],
      links: [{ rel: 'next', href: 'https://attacker.example/collect' }] });
    return Response.json({ total_pages: 2, items: [{ id: 'INV2-RECOVERED', detail: { invoice_number: number } }] });
  } });
  assert.equal(await client.findDraftByInvoiceNumber(number), 'INV2-RECOVERED');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.url.startsWith(SANDBOX + '/') && c.options.redirect === 'error'));
  assert.deepEqual(JSON.parse(calls[1].options.body), { invoice_number: number });
  assert.match(calls[2].url, /page=2&page_size=100/);
  await assert.rejects(client.findDraftByInvoiceNumber('http://attacker.example'), /Invalid local invoice/);
});

test('PayPal search refuses duplicate matches and truncated results', async () => {
  const number = 'TO-01234567890123456789';
  for (const body of [
    { total_pages: 1, items: ['A', 'B'].map(x => ({ id: 'INV2-'+x, detail: { invoice_number: number } })) },
    { total_pages: 4, items: [{ id: 'INV2-A', detail: { invoice_number: number } }] },
    { total_pages: 'unknown', items: [] },
  ]) {
    const client = new PayPalSandbox({ clientId: 'mock', clientSecret: 'mock', fetchImpl: async url => Response.json(
      url.endsWith('/token') ? { access_token: 'mock', expires_in: 3600 } : body) });
    await assert.rejects(client.findDraftByInvoiceNumber(number), /Multiple|limit|Invalid/);
  }
});

test('HTTP revision, review and history endpoints require the session token and preserve compatibility', async t => {
  const server = createApp({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), preview: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`, html = await (await fetch(base)).text();
  const token = /const token='([a-f0-9]+)'/.exec(html)[1];
  const headers = { 'X-TheOne-Token': token, 'Content-Type': 'application/json' };
  const post = async (path, body) => fetch(base+path, { method: 'POST', headers, body: JSON.stringify(body) });
  const p = (await (await post('/plan', { message: draft, request_id: 'http-command-001' })).json()).proposal;
  assert.equal((await fetch(`${base}/proposals/${p.id}/history`)).status, 403);
  const changed = await (await post('/revise', { id: p.id, revision: 1, changes: { amount: '520' } })).json();
  assert.equal(changed.revision, 2);
  const review = await (await fetch(`${base}/proposals/${p.id}/review`, { headers })).json();
  assert.equal(review.changes[0].after, '520.00'); assert.equal(review.sends_invoice, false);
  const history = await (await fetch(`${base}/proposals/${p.id}/history`, { headers })).json();
  assert.equal(history.versions.length, 2);
  assert.equal((await fetch(base+'/projects/design/brief')).status, 403);
  const brief = await (await fetch(base+'/projects/design/brief', { headers })).json();
  assert.equal(brief.awaiting_review.totals[0].amount, '520.00');
  assert.equal((await post('/approve', { id: p.id, digest: p.digest })).status, 409);
  assert.equal((await (await post('/plan', { message: draft, request_id: 'http-command-001' })).json()).replayed, true);
  await post('/plan', { message: 'Draft a 90 EUR invoice for the design client for project services.' });
  const state = await (await fetch(base+'/state', { headers })).json();
  assert.equal(state.proposals.at(-1).payload.items[0].unit_amount.value, '90.00');
  assert.equal((await fetch(base+'/routing/metrics')).status, 403);
  const metrics = await (await fetch(base+'/routing/metrics', { headers })).json();
  assert.equal(metrics.turns, 2); assert.equal(metrics.traced_turns, 0); assert.equal(metrics.calls, 0);
});
