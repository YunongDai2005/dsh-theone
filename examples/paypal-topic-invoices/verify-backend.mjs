// Reproducible local HTTP demonstration. ALL model and PayPal responses are simulated.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './server.mjs';
import { previewPlanner, previewTopics, previewPayPal } from './preview.mjs';

const directory = mkdtempSync(join(tmpdir(), 'one-invoice-demo-'));
const remote = previewPayPal();
let creates = 0, searches = 0, reads = 0;
const paypal = {
  ...remote,
  async createDraft(payload) {
    creates++; await remote.createDraft(payload);
    throw Error('Simulated response loss after the remote draft was created');
  },
  async getDraft(id) { reads++; return remote.getDraft(id); },
  async findDraftByInvoiceNumber(number) { searches++; return remote.findDraftByInvoiceNumber(number); },
};
const app = createApp({ topics: previewTopics, planner: previewPlanner, paypal, preview: true, database: join(directory, 'demo.sqlite') });
const steps = [];
try {
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.address().port}`;
  const html = await (await fetch(url)).text();
  const token = /const token='([a-f0-9]+)'/.exec(html)[1];
  const headers = { 'X-TheOne-Token': token, 'Content-Type': 'application/json' };
  const call = async (path, data, expected = 200) => {
    const response = await fetch(url + path, { method: data ? 'POST' : 'GET', headers, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const message = 'Draft a 480 EUR invoice for the design client for website assets.';
  const initial = await call('/plan', { message, request_id: 'judge-invoice-001' });
  steps.push({ step: 'propose', id: initial.proposal.id, revision: 1, state: initial.proposal.state, amount: '480.00 EUR' });
  const replay = await call('/plan', { message, request_id: 'judge-invoice-001' });
  assert.equal(replay.replayed, true); assert.equal(replay.proposal.id, initial.proposal.id);
  steps.push({ step: 'replay_request', same_proposal: true, duplicate_created: false });
  const revised = await call('/plan', { message: 'Actually, make it 520 EUR.', request_id: 'judge-revision-001' });
  assert.equal(revised.proposal.id, initial.proposal.id); assert.equal(revised.proposal.revision, 2);
  const review = await call(`/proposals/${initial.proposal.id}/review`);
  steps.push({ step: 'revise_in_conversation', revision: 2, changes: review.changes });
  await call('/approve', { id: initial.proposal.id, digest: initial.proposal.digest }, 409);
  steps.push({ step: 'reject_old_review', provider_creates: creates });
  const corrected = await call('/correct', { id: initial.proposal.id, revision: 2, topic_id: 'move' });
  assert.equal(corrected.payload.primary_recipients[0].billing_info.email_address, 'move-buyer@example.invalid');
  steps.push({ step: 'correct_project', revision: 3, project: corrected.topic_id, recipient: corrected.payload.primary_recipients[0].billing_info.email_address });
  await call('/approve', { id: corrected.id, digest: corrected.digest }, 502);
  const uncertain = await call(`/proposals/${corrected.id}/review`);
  assert.equal(uncertain.state, 'UNCERTAIN');
  steps.push({ step: 'response_lost_after_creation', state: uncertain.state, provider_creates: creates });
  const recovered = await call('/reconcile', { id: corrected.id });
  assert.equal(recovered.state, 'CREATED'); assert.equal(creates, 1); assert.equal(searches, 1);
  steps.push({ step: 'recover_by_invoice_number', state: recovered.state, invoice_number: recovered.payload.detail.invoice_number,
    searches, detail_reads: reads, provider_creates: creates });
  const status = await call('/plan', { message: 'What is the invoice status for the moving project?' });
  assert.match(status.plan.reply, /Verified unsent drafts: 1 \(520.00 EUR\)/);
  steps.push({ step: 'answer_from_records', reply: status.plan.reply });
  const design = await call('/plan', { message: 'Draft a new 480 EUR invoice for the design client for website assets.' });
  const other = await call('/plan', { message: 'Draft a separate 120 EUR invoice for the design client for consultation.' });
  assert.equal(design.proposal.topic_id, 'design'); assert.equal(other.proposal.topic_id, 'design');
  steps.push({ step: 'prepare_two_client_drafts', ids: [design.proposal.id, other.proposal.id] });
  const selected = await call('/plan', { message: 'Change the 480 EUR invoice to 550 EUR.' });
  assert.equal(selected.proposal.id, design.proposal.id); assert.equal(selected.proposal.revision, 2);
  steps.push({ step: 'select_by_original_amount', id: selected.proposal.id, amount: selected.proposal.payload.items[0].unit_amount.value });
  const otherReview = await call(`/proposals/${other.proposal.id}/review`);
  assert.equal(otherReview.revision, 1); assert.equal(otherReview.fields.amount, '120.00');
  const metrics = await call('/routing/metrics');
  assert.equal(metrics.traced_turns, 0); assert.equal(metrics.calls, 0);
  steps.push({ step: 'preserve_other_draft_and_report_evidence', other_revision: 1, real_routing_calls: metrics.calls });
  const duplicate = await call('/plan', { message: 'Draft a separate 120 EUR invoice for the design client for consultation.' });
  assert.equal(duplicate.proposal.id, other.proposal.id);
  steps.push({ step: 'deduplicate_without_request_id', same_proposal: true });
  await call('/discard', { id: other.proposal.id, revision: 1 });
  const remaining = await call('/projects/design/brief'); assert.equal(remaining.awaiting_review.count,1);
  steps.push({ step: 'discard_local_draft', awaiting_review: 1, discarded: remaining.discarded_count });
  const changes = { amount: '530', description: 'Relocation service' };
  const remoteReview = await call('/remote/review', { id: corrected.id, revision: 3, action: 'update', changes });
  const remoteUpdated = await call('/remote/apply', { id: corrected.id, revision: 3, action: 'update', changes, digest: remoteReview.digest });
  assert.equal(remoteUpdated.payload.items[0].unit_amount.value,'530.00');
  steps.push({ step: 'review_and_update_remote_draft', amount: '530.00', revision: 4 });
  const remoteStatus = await call('/remote/status', { id: corrected.id }); assert.equal(remoteStatus.status,'DRAFT');
  steps.push({ step: 'refresh_paypal_status', status: remoteStatus.status });
  const deletion = await call('/remote/review', { id: corrected.id, revision: 4, action: 'delete' });
  const deleted = await call('/remote/apply', { id: corrected.id, revision: 4, action: 'delete', digest: deletion.digest });
  assert.equal(deleted.state,'DELETED');
  steps.push({ step: 'review_delete_and_verify_absence', state: deleted.state });
  const history = await call(`/proposals/${corrected.id}/history`);
  const manifest = JSON.parse(readFileSync(new URL('./design-reference/2026-11-12-invoice-desk/manifest.json', import.meta.url), 'utf8'));
  const frontendHash = createHash('sha256').update(readFileSync(new URL('./index.html', import.meta.url))).digest('hex');
  assert.equal(frontendHash, manifest.frontend_sha256);
  const evidence = { checked_at: new Date().toISOString(), evidence_type: 'offline_http_workflow_simulated_providers',
    steps, versions: history.versions, events: history.events, routing_metrics: metrics, frontend_baseline_verified: true, frontend_sha256: frontendHash,
    real_model_calls: 0, real_paypal_calls: 0, invoice_sends: 0, payment_operations: 0 };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: steps.length, evidence_type: evidence.evidence_type, provider_creates: creates,
    recovery_searches: searches, revisions: history.versions.length, frontend_baseline_verified: true, real_paypal_calls: 0 }, null, 2));
} finally {
  await new Promise(resolve => app.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
