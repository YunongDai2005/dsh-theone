// Explicit live Sandbox verifier: one EUR 1.00 synthetic draft, update to EUR 1.01,
// search/read recovery and deletion. No model, email, publication or payment calls.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PayPalSandbox } from './adapters.mjs';
import { InvoiceWorkflow } from './workflow.mjs';

const output = resolve(process.argv[2] || '.data/sandbox-verification.json');
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const required = ['PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_SECRET','SANDBOX_RECIPIENT'];
const missing = required.filter(key => !process.env[key]);
const evidence = { checked_at: new Date().toISOString(), evidence_type: 'real_paypal_sandbox',
  status: missing.length ? 'NOT_RUN' : 'RUNNING', missing_configuration: missing, steps: [],
  source_sha256: Object.fromEntries(['adapters.mjs','workflow.mjs','verify-sandbox.mjs'].map(name => [name,
    createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex')])),
  calls: [], notifications: 0, published_invoices: 0, payments: 0 };
const save = () => writeFileSync(output, JSON.stringify(evidence,null,2)+'\n', { mode: 0o600 });
if (missing.length) {
  save(); console.log(JSON.stringify({ status:'NOT_RUN', missing_configuration: missing, real_paypal_calls:0, output }));
  process.exitCode = 2;
} else {
  let remoteId, localPayload;
  const paypal = new PayPalSandbox({ clientId: process.env.PAYPAL_SANDBOX_CLIENT_ID, clientSecret: process.env.PAYPAL_SANDBOX_CLIENT_SECRET,
    async fetchImpl(url,options) {
      evidence.calls.push({ path: new URL(url).pathname, method: options.method }); save();
      return fetch(url,options);
    } });
  const topics = [{ id:'sandbox_probe',title:'Sandbox verification',summary:'Synthetic verification only.',recipient:process.env.SANDBOX_RECIPIENT }];
  const planner = { async route() { return { model:'deterministic-test-input', decision:{ action:'EXISTING',contextId:'sandbox_probe',reason:'Explicit synthetic project' } }; },
    async plan() { return { model:'deterministic-test-input', plan:{ intent:'invoice_draft',topic_id:'sandbox_probe',amount:'1.00',currency:'EUR',description:'Synthetic integration verification',reply:'Review.' } }; } };
  const recoveryAdapter = {
    async createDraft(payload) {
      localPayload = payload; remoteId = await paypal.createDraft(payload);
      // Intentionally withhold the successful ID from the workflow to test real search recovery.
      throw Error('Controlled loss of the create response after a real Sandbox creation');
    },
    getDraft: paypal.getDraft.bind(paypal), getInvoice: paypal.getInvoice.bind(paypal),
    findDraftByInvoiceNumber: paypal.findDraftByInvoiceNumber.bind(paypal), updateDraft: paypal.updateDraft.bind(paypal), deleteDraft: paypal.deleteDraft.bind(paypal),
  };
  const workflow = new InvoiceWorkflow({ topics,planner,paypal:recoveryAdapter,database:output.replace(/\.json$/,'')+'.sqlite' });
  try {
    const proposed = (await workflow.plan('Draft a 1.00 EUR invoice for Sandbox verification for synthetic integration verification.')).proposal;
    evidence.invoice_number = proposed.payload.detail.invoice_number;
    try { await workflow.approve(proposed.id,proposed.digest); } catch (error) {
      if (!remoteId) throw error;
    }
    assert.equal(workflow.proposals()[0].state,'UNCERTAIN');
    evidence.steps.push({ step:'create_with_controlled_response_loss',passed:true }); save();
    let recovered, lastError;
    for (let attempt=1;attempt<=3;attempt++) {
      try { recovered = await workflow.reconcile(proposed.id); break; }
      catch (error) { lastError=error; if (attempt<3) await new Promise(r=>setTimeout(r,1500)); }
    }
    if (!recovered) throw lastError;
    assert.equal(recovered.remote_id,remoteId); assert.equal(recovered.state,'CREATED');
    evidence.steps.push({ step:'recover_by_real_invoice_search_and_verified_read',passed:true }); save();
    const changes = { amount:'1.01' }, review = workflow.reviewRemote(proposed.id,1,'update',changes);
    const updated = await workflow.applyRemote(proposed.id,1,'update',changes,review.digest);
    assert.equal(updated.payload.items[0].unit_amount.value,'1.01');
    evidence.steps.push({ step:'update_remote_draft_and_verify',passed:true }); save();
    const status = await workflow.refreshRemote(proposed.id); assert.equal(status.status,'DRAFT');
    evidence.steps.push({ step:'read_remote_status',passed:true });
    const deletion = workflow.reviewRemote(proposed.id,2,'delete');
    assert.equal((await workflow.applyRemote(proposed.id,2,'delete',undefined,deletion.digest)).state,'DELETED');
    evidence.steps.push({ step:'delete_and_verify_404',passed:true });
    evidence.status='PASSED';
  } catch (error) {
    evidence.status='FAILED'; evidence.error={ code:error.code ?? 'VERIFICATION_FAILED', message:error.message };
    process.exitCode=1;
  } finally {
    // Only clean up the exact unsent synthetic invoice created by this invocation.
    if (remoteId) try {
      const remaining = await paypal.getInvoice(remoteId);
      if (remaining) {
        assert.equal(remaining.status,'DRAFT');
        assert.equal(remaining.detail.invoice_number,localPayload.detail.invoice_number);
        assert.equal(remaining.detail.reference,'sandbox_probe');
        assert.equal(remaining.primary_recipients[0].billing_info.email_address,process.env.SANDBOX_RECIPIENT);
        assert.equal(remaining.items.length,1);
        assert.equal(remaining.items[0].name,localPayload.items[0].name);
        assert.equal(remaining.amount.currency_code,'EUR');
        assert.ok(['1.00','1.01'].includes(remaining.amount.value));
        await paypal.deleteDraft(remoteId);
        assert.equal(await paypal.getInvoice(remoteId),null);
      }
      evidence.cleanup='verified_absent';
    } catch { evidence.cleanup='unresolved_check_sandbox_by_invoice_number'; evidence.status='FAILED'; process.exitCode=1; }
    workflow.close(); save();
    console.log(JSON.stringify({ status:evidence.status,steps:evidence.steps.length,real_paypal_calls:evidence.calls.length,cleanup:evidence.cleanup,output }));
  }
}
