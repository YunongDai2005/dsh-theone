// Real adapter and workflow, fake HTTP transport. Not PayPal Sandbox evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InvoiceWorkflow } from './workflow.mjs';
import { PayPalSandbox, SANDBOX } from './adapters.mjs';
import { previewPlanner, previewTopics } from './preview.mjs';
const request = 'Draft a 480 EUR invoice for the design client for website assets.';

function transport() {
  let invoice = null;
  const control = { calls: [], loseMutationResponse: false, rejectMutation: false, rejectRead: false, hold: null };
  control.fetch = async (url, options) => {
    control.calls.push({ url, method: options.method, body: options.body });
    assert.ok(url.startsWith(SANDBOX + '/')); assert.equal(options.redirect, 'error');
    if (url.endsWith('/token')) return Response.json({ access_token: 'fake', expires_in: 3600 });
    if (options.method === 'GET') return control.rejectRead ? Response.json({}, { status: 401 }) : invoice ? Response.json(invoice) : Response.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    if (options.method === 'POST' && url.endsWith('/invoices')) {
      invoice = { ...JSON.parse(options.body), id: 'INV2-LIFECYCLE', status: 'DRAFT' };
      invoice.amount = structuredClone(invoice.items[0].unit_amount);
      invoice.invoicer = { business_name: 'Mock merchant' };
      return Response.json({ id: invoice.id });
    }
    if (control.rejectMutation) return Response.json({ details: [{ issue: 'INVALID_PARAMETER_VALUE' }] }, { status: 422 });
    if (control.hold) await control.hold;
    if (options.method === 'PUT') {
      assert.equal(new URL(url).searchParams.get('send_to_recipient'), 'false');
      assert.equal(new URL(url).searchParams.get('send_to_invoicer'), 'false');
      const payload = JSON.parse(options.body);
      assert.equal(payload.invoicer.business_name, 'Mock merchant');
      invoice = { ...payload, id: invoice.id, status: 'DRAFT', amount: structuredClone(payload.items[0].unit_amount) };
    } else if (options.method === 'DELETE') invoice = null;
    else if (url.endsWith('/send')) {
      assert.deepEqual(JSON.parse(options.body), { send_to_recipient: false, send_to_invoicer: false });
      invoice.status = 'SENT'; invoice.due_amount = structuredClone(invoice.amount);
      invoice.detail.metadata = { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/MOCK' };
    } else throw Error('Unexpected mock request');
    if (control.loseMutationResponse) throw Error('Simulated lost mutation response');
    return new Response(null, { status: 204 });
  };
  control.invoice = () => invoice;
  return control;
}
async function fixture(t) {
  const remote = transport(), paypal = new PayPalSandbox({ clientId: 'fake', clientSecret: 'fake', fetchImpl: remote.fetch });
  const directory = mkdtempSync(join(tmpdir(), 'invoice-lifecycle-'));
  const options = { topics: previewTopics, planner: previewPlanner, paypal, database: join(directory,'db.sqlite') };
  let app = new InvoiceWorkflow(options);
  t.after(() => { app.close(); rmSync(directory, { recursive: true, force: true }); });
  const p = (await app.plan(request)).proposal;
  await app.approve(p.id,p.digest);
  return { get app() { return app; }, remote, p, restart() { app.close(); app = new InvoiceWorkflow(options); } };
}
function apply(app, review, changes) { return app.applyRemote(review.id,review.revision,review.action,changes,review.digest); }

test('remote update has separate review, preserves merchant data, verifies readback and rejects stale approvals', async t => {
  const { app,remote,p } = await fixture(t), changes = { amount: '520', description: 'Revised assets' };
  const before = remote.calls.length, review = app.reviewRemote(p.id,1,'update',changes);
  assert.equal(remote.calls.length,before); assert.equal(review.sends_email,false);
  await assert.rejects(app.applyRemote(p.id,1,'update',{ amount: '999' },review.digest), /Review changed/);
  const updated = await apply(app,review,changes);
  assert.equal(updated.revision,2); assert.equal(updated.state,'CREATED');
  assert.equal(updated.payload.items[0].unit_amount.value,'520.00');
  assert.equal((await apply(app,review,changes)).revision,2);
  assert.equal(remote.calls.filter(c => c.method === 'PUT').length,1);
  assert.equal(app.history(p.id).versions.at(-1).cause,'remote_update_verified');
});

for (const action of ['update','delete','publish']) test(`lost ${action} response recovers after restart with GET only`, async t => {
  const f = await fixture(t), changes = action === 'update' ? { amount: '520' } : undefined;
  const review = f.app.reviewRemote(f.p.id,1,action,changes);
  f.remote.loseMutationResponse = true;
  await assert.rejects(apply(f.app,review,changes), /outcome is unknown/);
  assert.equal(f.app.proposals()[0].state,'REMOTE_UNCERTAIN');
  await assert.rejects(apply(f.app,review,changes), /current verified/);
  const before = f.remote.calls.length;
  f.restart();
  const result = await f.app.reconcileRemote(f.p.id);
  assert.equal(result.state, action === 'update' ? 'CREATED' : action === 'delete' ? 'DELETED' : 'REMOTE_ACTIVE');
  assert.ok(f.remote.calls.slice(before).every(c => c.method === 'GET'));
  const snapshot = await f.app.refreshRemote(f.p.id);
  assert.equal(snapshot.source,'paypal_sandbox_get');
  if (action === 'publish') assert.equal(snapshot.payment_link,'https://www.sandbox.paypal.com/invoice/p/MOCK');
});

test('definite remote rejection is reviewable; a concurrent operation cannot submit twice', async t => {
  const { app,remote,p } = await fixture(t), changes = { amount: '520' };
  const review = app.reviewRemote(p.id,1,'update',changes);
  remote.rejectMutation = true;
  await assert.rejects(apply(app,review,changes)); assert.equal(app.proposals()[0].state,'CREATED');
  remote.rejectMutation = false;
  let release; remote.hold = new Promise(r => { release = r; });
  const first = apply(app,review,changes);
  await assert.rejects(apply(app,review,changes), /current verified/);
  await assert.rejects(app.reconcileRemote(p.id), /still in progress/);
  release(); await first;
});

test('remote drift and scheduled sends are rejected before mutation; active invoices cannot be deleted as drafts', async t => {
  const { app,remote,p } = await fixture(t);
  const review = app.reviewRemote(p.id,1,'publish');
  remote.invoice().amount.value = '999.00';
  await assert.rejects(apply(app,review), /does not match/);
  remote.invoice().amount.value = '480.00'; remote.invoice().detail.invoice_date = '2099-01-01';
  await assert.rejects(apply(app,review), /Scheduled/);
  delete remote.invoice().detail.invoice_date;
  await apply(app,review);
  assert.throws(() => app.reviewRemote(p.id,2,'delete'), /current verified/);
  remote.invoice().status = 'PAID'; remote.invoice().due_amount.value = '0.00';
  const status = await app.refreshRemote(p.id);
  assert.equal(status.status,'PAID'); assert.equal(status.due_amount.value,'0.00');
  assert.equal(app.brief('design').remote_statuses[0].status,'PAID');
});

test('401 read does not prove deletion; untrusted payment links are omitted', async t => {
  const { app,remote,p } = await fixture(t);
  remote.rejectRead = true;
  await assert.rejects(app.refreshRemote(p.id)); assert.equal(app.proposals()[0].state,'CREATED');
  remote.rejectRead = false;
  remote.invoice().detail.metadata = { recipient_view_url: 'https://evil.invalid/invoice/p/secret' };
  assert.equal((await app.refreshRemote(p.id)).payment_link,undefined);
});
