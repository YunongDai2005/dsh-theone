// Offline regression probes: no provider credentials or real external effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceWorkflow } from './workflow.mjs';
import { ModelPlanner, PayPalSandbox } from './adapters.mjs';
import { previewPlanner, previewTopics, previewPayPal } from './preview.mjs';
import { guardCustomerRoute } from './routing.mjs';
import { routingEvidence } from './routing-intelligence.mjs';
import { selectDraft } from './invoice-selection.mjs';
import { groundMoney, moneyMentions } from './invoice-input.mjs';
import { publicError } from './errors.mjs';

const request = 'Draft a 480 EUR invoice for the design client for website assets.';
const plan = { intent: 'invoice_draft', topic_id: 'design', amount: '480.00', currency: 'EUR', description: 'Website assets', reply: 'Review.' };
const route = { action: 'EXISTING', contextId: 'design', reason: 'fixture' };
function fixture(t, options = {}) {
  const app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), ...options });
  t.after(() => app.close()); return app;
}
function provider(fetchImpl) { return new PayPalSandbox({ clientId: 'fake', clientSecret: 'fake', fetchImpl }); }

for (const failure of ['oauth401', 'create422']) test(`${failure} restores editable review and invalidates the old approval`, async t => {
  let failing = true, creates = 0, payload;
  const paypal = provider(async (url, options) => {
    if (url.endsWith('/token')) return failing && failure === 'oauth401' ? Response.json({ name: 'AUTHENTICATION_FAILURE' }, { status: 401 }) : Response.json({ access_token: 'fake', expires_in: 3600 });
    if (options.method === 'POST') {
      creates++; if (failing) return Response.json({ details: [{ issue: 'INVALID_PARAMETER_VALUE' }] }, { status: 422 });
      payload = JSON.parse(options.body); return Response.json({ id: 'INV2-AUDIT' });
    }
    return Response.json({ ...payload, id: 'INV2-AUDIT', status: 'DRAFT', amount: payload.items[0].unit_amount });
  });
  const app = fixture(t, { paypal }), original = (await app.plan(request)).proposal;
  await assert.rejects(app.approve(original.id, original.digest), error => error.details.remote_outcome === 'not_created');
  const restored = app.proposals()[0];
  assert.equal(restored.state, 'REVIEW'); assert.equal(restored.revision, 2);
  assert.equal(creates, failure === 'oauth401' ? 0 : 1);
  await assert.rejects(app.approve(original.id, original.digest), /Review changed/);
  failing = false;
  assert.equal((await app.approve(restored.id, restored.digest)).state, 'CREATED');
  assert.equal(app.brief('design').needs_verification.count, 0);
});

for (const issue of ['DUPLICATE_INVOICE_NUMBER', 'network']) test(`${issue} stays uncertain and cannot repeat create`, async t => {
  const paypal = provider(async url => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'fake', expires_in: 3600 });
    if (issue === 'network') throw Error('lost');
    return Response.json({ details: [{ issue }] }, { status: 422 });
  });
  const app = fixture(t, { paypal }), p = (await app.plan(request)).proposal;
  await assert.rejects(app.approve(p.id, p.digest));
  assert.equal(app.proposals()[0].state, 'UNCERTAIN');
  await assert.rejects(app.approve(p.id, p.digest), /uncertain/);
  assert.throws(() => app.discard(p.id, p.revision), /Acknowledge/);
  assert.equal(app.discard(p.id, p.revision, true).state, 'ARCHIVED_UNCERTAIN');
  assert.equal(app.brief('design').needs_verification.count, 0);
  assert.equal(app.brief('design').archived_uncertain_count, 1);
  assert.equal(app.review(p.id).can_reconcile, true);
});

test('duplicate requests without request IDs reuse one draft; discarded drafts leave active totals', async t => {
  const app = fixture(t);
  const [first, second] = await Promise.all([app.plan(request), app.plan(request)]);
  assert.equal(first.proposal.id, second.proposal.id);
  assert.equal(app.brief('design').awaiting_review.count, 1);
  assert.equal(app.discard(first.proposal.id, 1).state, 'DISCARDED');
  assert.equal(app.brief('design').awaiting_review.count, 0);
  assert.equal(app.brief('design').discarded_count, 1);
  await assert.rejects(app.approve(first.proposal.id, first.proposal.digest));
  assert.equal((await app.plan(request)).proposal.state, 'REVIEW');
  assert.equal(app.brief('design').awaiting_review.count, 1);
});

test('explicit customer outranks the current project for every supported billing verb', () => {
  for (const verb of ['invoice', 'invoices', 'invoiced', 'charge', '账单', '开票']) {
    assert.equal(guardCustomerRoute(`${verb} 480 EUR for the Moving project`, previewTopics, { currentId: 'design' }, route).action, 'CLARIFY');
    assert.equal(guardCustomerRoute(`${verb} 480 EUR for that client`, previewTopics, { currentId: null }, route).action, 'CLARIFY');
  }
  assert.equal(guardCustomerRoute('How do I read my electricity bill?', previewTopics, {}, route), null);
});

test('unsupported model amounts cannot become drafts; failed user requests remain inspectable', async t => {
  const app = fixture(t, { planner: { ...previewPlanner, async plan() { return { model: 'fake', plan: { ...plan, amount: '4800' } }; } } });
  await assert.rejects(app.plan(request), /not supported/);
  assert.equal(app.proposals().length, 0);
  assert.equal(app.attempts()[0].message, request);
  assert.equal(app.attempts()[0].status, 'FAILED');
  assert.equal(app.routingMetrics().failed_turns, 1);
});

for (const bad of [{ ...plan, amount: 480 }, { ...plan, extra: true }, { ...plan, amount: '4800.00' }]) {
  test(`planning validation retries and repairs ${typeof bad.amount === 'number' ? 'numeric amount' : bad.extra ? 'extra field' : 'ungrounded amount'}`, async t => {
    let count = 0, feedback;
    const planner = new ModelPlanner({ baseUrl: 'https://fake.invalid/v1', apiKey: 'fake', model: 'fake', fetchImpl: async (_, options) => {
      count++; feedback = JSON.parse(JSON.parse(options.body).messages[1].content).validationFeedback;
      return Response.json({ choices: [{ message: { content: JSON.stringify(count === 1 ? route : count === 2 ? bad : plan) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    } });
    const app = fixture(t, { planner }), result = await app.plan(request);
    assert.equal(count, 3); assert.ok(feedback); assert.equal(result.proposal.payload.items[0].unit_amount.value, '480.00');
    const metrics = app.routingMetrics();
    assert.equal(metrics.planning_calls, 2); assert.equal(metrics.retries, 1); assert.equal(metrics.failed_calls, 1);
  });
}

test('exhausted planning retries return 502 with persisted failed turn and all call usage', async t => {
  let count = 0;
  const planner = new ModelPlanner({ baseUrl: 'https://fake.invalid/v1', apiKey: 'fake', model: 'fake', fetchImpl: async () => {
    count++; return Response.json({ choices: [{ message: { content: JSON.stringify(count === 1 ? route : { ...plan, amount: 480 }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  } });
  const app = fixture(t, { planner });
  await assert.rejects(app.plan(request, 'failed-request'), error => {
    const result = publicError(error); return result.status === 502 && Boolean(result.body.attempt_id);
  });
  assert.equal(count, 3); assert.equal(app.messages().length, 0);
  const metrics = app.routingMetrics();
  assert.equal(metrics.failed_turns, 1); assert.equal(metrics.calls, 3); assert.equal(metrics.prompt_tokens, 30);
  assert.equal(app.attempts()[0].calls.length, 3);
});

test('invoice selection accepts currency symbols, names, reordered English and Chinese', async t => {
  const app = fixture(t), p = (await app.plan(request)).proposal;
  const other = (await app.plan('Draft a 120 EUR invoice for the design client for consultation.')).proposal;
  for (const message of ['Change the €480 invoice to €550.', 'Change the 480 euro invoice to 550 EUR.', 'Change the invoice for 480 EUR to 550 EUR.', '把480欧元的发票改成550欧元。', '发票金额为480欧元，改为550欧元']) {
    assert.equal(selectDraft(message, [p,other]), p.id, message);
    groundMoney({ ...plan, intent: 'invoice_update', proposal_id: p.id, amount: '550.00' }, message, [], [{ id: p.id, currency: 'EUR' }]);
  }
  assert.equal(selectDraft('Change it to 480 EUR.', [p,other]), null);
  assert.deepEqual(moneyMentions('EUR480.123'), []);
});

test('numeric invoice totals are not project evidence; explicit named projects suppress other-project history clues', () => {
  const hints = routingEvidence('480 EUR invoice for the moving project', previewTopics, [{ id: 'design', texts: ['480 EUR invoice for Zinnia'] }]);
  assert.ok(!hints.some(h => h.contextId === 'design'));
  assert.deepEqual(routingEvidence('480 EUR invoice', previewTopics, [{ id: 'design', texts: ['480 EUR'] }]), []);
});
