// Genuine inference only: a hard cap of 24 model calls over eight synthetic turns.
// No PayPal operation exists in this verifier; it never falls back to scripted output.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ModelPlanner } from './adapters.mjs';
import { InvoiceWorkflow } from './workflow.mjs';

const env = process.env;
const required = ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME'];
const missing = required.filter(key => !env[key]);
if (missing.length) {
  console.error(JSON.stringify({ evidence_type: 'real_model_not_run', missing_configuration: missing }));
  process.exit(1);
}
const calls = [], maxCalls = Number(env.MODEL_MAX_CALLS || 24);
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 24) throw Error('Model call limit must be 1–24');
const scope = env.MODEL_TEST_SCOPE || 'full';
if (!['full', 'customer-binding', 'clarification-only'].includes(scope)) throw Error('Unknown model test scope');
const planner = new ModelPlanner({ baseUrl: env.MODEL_BASE_URL, apiKey: env.MODEL_API_KEY,
  model: env.MODEL_NAME, disableThinking: env.MODEL_DISABLE_THINKING === 'true', reasoningStyle: env.MODEL_REASONING_STYLE || 'none',
  onCall(detail) { if (calls.length >= maxCalls) throw Error('Small-run model call budget reached'); calls.push(detail); } });
const topics = [
  { id: 'design', title: 'Design client', summary: 'Website design services and customer invoices.', recipient: 'design@example.invalid' },
  { id: 'move', title: 'Moving project', summary: 'Moving logistics and relocation invoices.', recipient: 'move@example.invalid' },
  { id: 'budget', title: 'Household budget', summary: 'Personal spending; not a customer to invoice.', recipient: 'budget@example.invalid', invoice_enabled: false },
];
const paypal = { async createDraft() { throw Error('PayPal disabled in model-only verification'); } };
const results = [], attemptMetrics = [];
let firstId, secondId, firstDescription;
const exactDraft = (proposal, amount) => proposal?.topic_id === 'design' && proposal.state === 'REVIEW'
  && proposal.payload.items[0].unit_amount.value === amount
  && proposal.payload.items[0].unit_amount.currency_code === 'EUR'
  && proposal.payload.primary_recipients[0].billing_info.email_address === 'design@example.invalid';
const named = (app, id) => app.proposals().find(p => p.id === id);
const scenarios = [
  [
    ['Draft a 480 EUR invoice for the design client for website assets.', (r, app) => {
      firstId = r.proposal?.id;
      firstDescription = r.proposal?.payload.items[0].name;
      return r.plan.intent === 'invoice_draft' && r.route.topicId === 'design' && exactDraft(r.proposal, '480.00') && app.proposals().length === 1;
    }],
    ['Record 72 EUR of moving expenses in my household budget. Do not create an invoice.', (r, app) =>
      r.plan.intent === 'chat' && r.route.topicId === 'budget' && app.proposals().length === 1 && exactDraft(named(app, firstId), '480.00')],
    ['Back to the design client. Change the existing draft to 520 EUR.', (r, app) =>
      r.plan.intent === 'invoice_update' && r.proposal?.id === firstId && r.proposal?.revision === 2 && exactDraft(r.proposal, '520.00')
      && r.proposal.payload.items[0].name === firstDescription && app.proposals().length === 1],
    ['What is the invoice status for the design client?', r =>
      r.plan.intent === 'invoice_status' && r.plan.reply.includes('520.00 EUR') && !r.plan.reply.includes('72.00')],
    ['Draft a separate 120 EUR invoice for the design client for a consultation.', (r, app) => {
      secondId = r.proposal?.id;
      return r.plan.intent === 'invoice_draft' && secondId !== firstId && exactDraft(r.proposal, '120.00')
        && exactDraft(named(app, firstId), '520.00') && app.proposals().length === 2;
    }],
    ['Change the 520 EUR invoice for the design client to 550 EUR.', (r, app) =>
      r.plan.intent === 'invoice_update' && r.proposal?.id === firstId && r.proposal?.revision === 3 &&
      exactDraft(r.proposal, '550.00') && r.proposal.payload.items[0].name === firstDescription
      && exactDraft(named(app, secondId), '120.00') && named(app, secondId).revision === 1 && app.proposals().length === 2],
  ],
  [
    ['Draft a 480 EUR invoice for that client for project services.', (r, app) => r.plan.intent === 'clarify' && app.proposals().length === 0],
    ['The design client.', (r, app) => r.route.topicId === 'design' && exactDraft(r.proposal, '480.00') && app.proposals().length === 1],
  ],
];
let stopped = false;
const selectedScenarios = scope === 'customer-binding' ? [scenarios[1], [scenarios[0][0]]]
  : scope === 'clarification-only' ? [scenarios[1]] : scenarios;
const planned = selectedScenarios.reduce((n, steps) => n + steps.length, 0);
for (const [scenarioIndex, steps] of selectedScenarios.entries()) {
  if (stopped) break;
  const workflow = new InvoiceWorkflow({ topics, planner, paypal });
  try {
    for (const [message, check] of steps) {
      try {
        const result = await workflow.plan(message);
        const businessPassed = Boolean(check(result, workflow));
        const englishPassed = !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(result.plan.reply);
        const passed = businessPassed && englishPassed;
        const ledger = workflow.proposals().map(p => ({ id: p.id, topic_id: p.topic_id, revision: p.revision, state: p.state,
          amount: p.payload.items[0].unit_amount.value, currency: p.payload.items[0].unit_amount.currency_code,
          description: p.payload.items[0].name, recipient: p.payload.primary_recipients[0].billing_info.email_address }));
        results.push({ scenario: scenarioIndex + 1, input: message, ...result, ledger, businessPassed, englishPassed, passed });
        console.error(JSON.stringify({ step: results.length, planned, passed, calls: calls.length }));
        if (!passed) { stopped = true; break; }
      } catch (error) {
        results.push({ scenario: scenarioIndex + 1, input: message, error: error.message, passed: false });
        stopped = true; break;
      }
    }
  } finally { attemptMetrics.push(workflow.routingMetrics()); workflow.close(); }
}
const evidence = { checked_at: new Date().toISOString(), evidence_type: 'real_model_only_no_paypal',
  source_sha256: Object.fromEntries(['adapters.mjs', 'workflow.mjs', 'routing.mjs', 'routing-prompt.mjs',
    'routing-intelligence.mjs', 'invoice-selection.mjs', 'invoice-input.mjs', 'errors.mjs', 'verify-live-model.mjs', 'index.html']
    .map(name => [name, createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex')])),
  synthetic_inputs: true, scope, planned_turns: planned, model: env.MODEL_NAME, routing_version: '0.4.6-adapted', results, calls, attemptMetrics, call_limit: maxCalls,
  totals: { calls: calls.length, prompt_tokens: calls.reduce((n, c) => n + (c.promptTokens ?? 0), 0),
    completion_tokens: calls.reduce((n, c) => n + (c.completionTokens ?? 0), 0),
    cache_hit_tokens: calls.reduce((n, c) => n + (c.cacheHitTokens ?? 0), 0),
    usage_reported_calls: calls.filter(c => c.promptTokens !== undefined && c.completionTokens !== undefined).length,
    elapsed_ms: calls.reduce((n, c) => n + c.elapsedMs, 0) }, paypal_calls: 0 };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ evidence_type: evidence.evidence_type, model: evidence.model,
  passed: results.filter(r => r.passed).length, attempted: results.length, planned, totals: evidence.totals,
  error: results.find(r => r.error)?.error ?? null, paypal_calls: 0 }));
if (results.length !== planned || !results.every(r => r.passed)) process.exitCode = 1;
