// Genuine inference only. This script performs NO PayPal operation.
import { writeFileSync } from 'node:fs';
import { ModelPlanner } from './adapters.mjs';
import { validatePlan } from './workflow.mjs';
const env = process.env;
const planner = new ModelPlanner({ baseUrl: env.MODEL_BASE_URL, apiKey: env.MODEL_API_KEY,
  model: env.MODEL_NAME, disableThinking: env.MODEL_DISABLE_THINKING === 'true' });
const topics = [
  { id: 'design', title: 'Design client', summary: 'Website design services and customer invoices.' },
  { id: 'move', title: 'Apartment move', summary: 'Moving logistics, movers and relocation work.' },
  { id: 'budget', title: 'Household budget', summary: 'Personal monthly spending and categorizing expenses; not a customer to invoice.' },
];
const inputs = [
  'Draft a 480 EUR invoice for the design client for website assets.',
  'Add the 480 EUR moving bill as an expense in my monthly budget. Do not create an invoice.',
  'Make an invoice for that thing we discussed earlier.',
];
const checks = [p => p.intent === 'invoice_draft' && p.topic_id === 'design' && p.amount === '480.00' && p.currency === 'EUR',
  p => p.intent === 'chat' && p.topic_id === 'budget', p => p.intent === 'clarify'];
const results = [];
for (let i = 0; i < inputs.length; i++) {
  let result;
  try {
    result = await planner.plan(inputs[i], topics);
    const plan = validatePlan(result.plan, topics);
    results.push({ input: inputs[i], ...result, plan, passed: checks[i](plan) });
  } catch (error) {
    results.push({ input: inputs[i], invalid_result: result, error: error.message, passed: false });
    break; // Do not retry an unavailable service or silently switch to a fixture.
  }
}
const evidence = { checked_at: new Date().toISOString(), evidence_type: 'real_model_only_no_paypal',
  synthetic_inputs: true, model: env.MODEL_NAME, results };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ evidence_type: evidence.evidence_type, model: evidence.model,
  passed: results.filter(r => r.passed).length, attempted: results.length, planned: inputs.length,
  error: results.find(r => r.error)?.error ?? null }));
if (results.length !== inputs.length || !results.every(r => r.passed)) process.exitCode = 1;
