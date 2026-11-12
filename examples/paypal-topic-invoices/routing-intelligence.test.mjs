import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelPlanner } from './adapters.mjs';
import { InvoiceWorkflow } from './workflow.mjs';
import { previewPlanner, previewTopics as topics, previewPayPal } from './preview.mjs';
import { routingEvidence, secondLook, continuationRoute, answerJson } from './routing-intelligence.mjs';
import { selectDraft } from './invoice-selection.mjs';
import { redact } from './routing.mjs';

const existing = contextId => ({ action: 'EXISTING', contextId, reason: 'Test routing decision.' });
const fresh = { action: 'CREATE', contextId: null, title: 'Gardening', historyIndependent: true, reason: 'New work.' };
function modelWith(responses, extra = {}) {
  const requests = [], calls = [];
  const planner = new ModelPlanner({ baseUrl: 'https://model.example.invalid/v1', apiKey: 'test-only', model: 'test-model',
    onCall: c => calls.push(c), ...extra, fetchImpl: async (url, options) => {
      requests.push(JSON.parse(options.body));
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (response instanceof Response) return response;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: typeof response === 'string' ? response : JSON.stringify(response) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 50 } });
    } });
  return { planner, requests, calls };
}

test('strong project-only details trigger recheck; shared details cancel the hint', () => {
  const memory = [{ id: 'design', texts: ['Reference AX-731, amount 480 EUR.'] }, { id: 'move', texts: ['Reference BX-412.'] }];
  assert.deepEqual(routingEvidence('Update AX-731.', topics, memory), [{ contextId: 'design', terms: ['ax-731'] }]);
  assert.equal(secondLook(existing('move'), routingEvidence('Update AX-731.', topics, memory)).trigger, 'evidence-conflict');
  assert.equal(secondLook(existing('design'), routingEvidence('Update AX-731.', topics, memory)), null);
  assert.deepEqual(routingEvidence('Update 480.', topics, [...memory, { id: 'budget', texts: ['480'] }]), []);
  assert.equal(secondLook({ ...fresh, aside: true }, []), null);
});

test('quick route sees no evidence hints; conflicting decision gets one instrumented recheck', async () => {
  const { planner, requests } = modelWith([existing('move'), existing('design')], { reasoningStyle: 'openai' });
  const result = await planner.route('Update AX-731.', topics, { memories: [{ id: 'design', texts: ['AX-731: website assets'] }] });
  assert.equal(result.decision.contextId, 'design'); assert.equal(result.trace.recheck.accepted, true);
  assert.equal(requests.length, 2); assert.equal(requests[0].reasoning_effort, 'none');
  assert.ok(!('reasoning_effort' in requests[1]));
  assert.ok(!('recheck' in JSON.parse(requests[0].messages[1].content)));
  assert.deepEqual(JSON.parse(requests[1].messages[1].content).recheck.terms, ['ax-731']);
  assert.deepEqual(result.trace.calls.map(c => c.layer), ['quick', 'recheck']);
  assert.equal(result.usage.prompt_tokens, 200); assert.equal(result.usage.prompt_cache_hit_tokens, 100);
  assert.ok(result.elapsedMs >= 0);
});

test('uncertain customer evidence fails closed when the optional recheck is unavailable', async () => {
  const { planner, requests } = modelWith([existing('move'), new Response('', { status: 429 })]);
  const result = await planner.route('Update AX-731.', topics, { memories: [{ id: 'design', texts: ['AX-731'] }] });
  assert.equal(result.decision.action, 'CLARIFY'); assert.equal(result.trace.recheck.accepted, false);
  assert.deepEqual(result.decision.candidateIds, ['design', 'move']); assert.equal(requests.length, 2);
  assert.match(result.trace.calls[1].error, /429/);
});

test('CREATE and CLARIFY get a second look; a one-off aside avoids the extra call', async () => {
  for (const value of [fresh, { action: 'CLARIFY', contextId: null, reason: 'Ambiguous.', question: 'Which project?', candidateIds: ['design', 'move'] }]) {
    const { planner, requests } = modelWith([value, value]);
    const result = await planner.route('A request about something.', topics);
    assert.equal(requests.length, 2); assert.equal(result.trace.recheck.accepted, true);
  }
  const { planner, requests } = modelWith([{ ...fresh, aside: true }]);
  const result = await planner.route('What is 2 plus 2?', topics);
  assert.equal(requests.length, 1); assert.equal(result.trace.recheck.skipped, 'aside');
});

test('continuations respect pending questions and foreground return; acknowledgements never approve', async () => {
  const context = { currentId: 'budget', attention: { foreground: { topicId: 'budget', returnTopicId: 'design' }, pending: [{ topicId: 'design' }] } };
  const { planner, requests } = modelWith([]);
  const result = await planner.route('Continue.', topics, context);
  assert.equal(result.decision.contextId, 'design'); assert.equal(result.trace.tier, 'continuation'); assert.equal(requests.length, 0);
  assert.equal(continuationRoute('Yes', topics, { ...context, pendingQuestion: { question: 'Which client?' } }), null);
  assert.equal(continuationRoute('Yes', topics, { ...context, attention: { pending: [{ topicId: 'design' }, { topicId: 'move' }] } }), null);
  assert.equal(continuationRoute('more', topics, { currentId: 'budget', attention: { foreground: context.attention.foreground } }).contextId, 'budget');
  const live = modelWith([existing('design'), { intent: 'invoice_draft', topic_id: 'design', amount: '480', currency: 'EUR', description: 'Assets', reply: 'Ready for review.' },
    { intent: 'chat', topic_id: 'design', amount: null, currency: null, description: null, reply: 'Draft still awaits review.' }]);
  const workflow = new InvoiceWorkflow({ topics, planner: live.planner, paypal: { createDraft() { throw Error('Must not approve'); } } });
  try {
    await workflow.plan('Draft a 480 EUR invoice for the design client for assets.');
    const notes = await workflow.plan('Yes');
    assert.equal(notes.plan.intent, 'chat'); assert.equal(workflow.proposals()[0].state, 'REVIEW');
    assert.equal(notes.route.trace.tier, 'continuation'); assert.equal(live.requests.length, 3);
  }
  finally { workflow.close(); }
});

test('JSON wrappers and thinking are parsed, but prose and unfinished answers are rejected', async () => {
  assert.deepEqual(answerJson('<think>hidden</think>\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => answerJson('Here is your decision: {"a":1}'), /invalid JSON/);
  const truncated = Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(existing('design')) } }] });
  const { planner, requests, calls } = modelWith([truncated, existing('design')]);
  const result = await planner.route('A design note.', topics);
  assert.equal(result.decision.contextId, 'design'); assert.equal(requests.length, 2); assert.equal(calls[1].attempt, 2);
  assert.match(calls[0].error, /incomplete/);
});

test('transient and malformed route responses retry once; credentials and rate limits never retry', async () => {
  for (const first of [new Response('', { status: 503 }), '{bad', existing('unknown')]) {
    const { planner, requests } = modelWith([first, existing('design')]);
    assert.equal((await planner.route('Design note.', topics)).decision.contextId, 'design'); assert.equal(requests.length, 2);
  }
  for (const status of [400, 401, 402, 403, 429]) {
    const { planner, requests } = modelWith([new Response('', { status })]);
    await assert.rejects(planner.route('Design note.', topics), new RegExp(String(status))); assert.equal(requests.length, 1);
  }
  const { planner, requests } = modelWith(['bad', 'bad', existing('design')]);
  await assert.rejects(planner.route('Design note.', topics), /invalid JSON/); assert.equal(requests.length, 2);
});

test('provider errors cannot leak secrets and quota enforcement runs before transport', async () => {
  const { planner, calls } = modelWith([new Error('secret-header-value'), new Error('secret-header-value')]);
  await assert.rejects(planner.route('Design.', topics), /network failure/);
  assert.ok(!JSON.stringify(calls).includes('secret-header'));
  const quota = modelWith([], { onCall() { throw Error('Model call budget reached'); } });
  await assert.rejects(quota.planner.route('Design.', topics), /budget/); assert.equal(quota.requests.length, 0);
  const sample = 'oc_sk_exampleprefix_exampletestkey12345';
  assert.ok(!redact(sample).includes(sample));
  assert.equal(redact('secret=not-for-the-model'), 'secret=[redacted]');
});

test('explicit original amount or service selects one draft; new amounts and duplicate matches do not', () => {
  const draft = (id, name, value) => ({ id, payload: { detail: { invoice_number: 'TO-' + id }, items: [{ name, unit_amount: { value, currency_code: 'EUR' } }] } });
  const a = draft('a', 'Website assets', '480.00'), b = draft('b', 'Consultation', '120.50');
  assert.equal(selectDraft('Change the 480 EUR invoice to 520 EUR.', [a, b]), 'a');
  assert.equal(selectDraft('Update the Website assets invoice to 520 EUR.', [a, b]), 'a');
  assert.equal(selectDraft('Update the 120.50 EUR invoice to 200 EUR.', [a, b]), 'b');
  assert.equal(selectDraft('Make it 480 EUR.', [a, b]), null);
  assert.equal(selectDraft('Change the 480 EUR invoice to 520 EUR.', [a, draft('c', 'Another', '480.00')]), null);
  assert.equal(selectDraft('Change TO-a and TO-b to 520 EUR.', [a, b]), null);
  assert.equal(selectDraft('Change the 1480 EUR invoice to 520 EUR.', [a, b]), null);
});

test('natural draft selection changes the intended invoice; a contradictory planner is blocked', async t => {
  let wrong = false;
  const planner = { ...previewPlanner, async plan(m, catalog, c) {
    const result = await previewPlanner.plan(m, catalog, c);
    if (wrong && result.plan.intent === 'invoice_update') {
      const other = c.drafts.find(p => p.id !== c.selectedDraftId);
      result.plan.proposal_id = other.id; result.plan.revision = other.revision;
    }
    return result;
  } };
  const app = new InvoiceWorkflow({ topics, planner, paypal: previewPayPal() }); t.after(() => app.close());
  const a = (await app.plan('Draft a 480 EUR invoice for the design client for website assets.')).proposal;
  const b = (await app.plan('Draft a 120 EUR invoice for the design client for consultation.')).proposal;
  const revised = await app.plan('Change the 480 EUR invoice to 520 EUR.');
  assert.equal(revised.proposal.id, a.id); assert.equal(revised.proposal.revision, 2);
  wrong = true;
  const declined = await app.plan('Change the 120 EUR invoice to 200 EUR.');
  assert.equal(declined.plan.intent, 'clarify'); assert.equal(declined.proposal, null);
  assert.equal(app.proposals().find(p => p.id === b.id).revision, 1);
});

test('routing trace persists once per user turn and reports measured token and recheck totals', async t => {
  const note = { intent: 'chat', topic_id: 'design', amount: null, currency: null, description: null, reply: 'Saved.' };
  const { planner } = modelWith([existing('design'), note, note]);
  const app = new InvoiceWorkflow({ topics, planner, paypal: previewPayPal() }); t.after(() => app.close());
  await app.plan('A note for the design client.', 'measured-turn-1');
  await app.plan('A note for the design client.', 'measured-turn-1');
  await app.plan('Thanks.');
  const metrics = app.routingMetrics();
  assert.equal(metrics.turns, 2); assert.equal(metrics.traced_turns, 2); assert.equal(metrics.calls, 3);
  assert.equal(metrics.continuation_turns, 1); assert.equal(metrics.prompt_tokens, 300);
  assert.equal(metrics.completion_tokens, 60); assert.equal(metrics.usage_reported_calls, 3);
  assert.equal(app.proposals().length, 0);
});

test('explicit selection recalls an older draft outside the model window, but hidden duplicates remain ambiguous', async t => {
  const app = new InvoiceWorkflow({ topics, planner: previewPlanner, paypal: previewPayPal() }); t.after(() => app.close());
  let first;
  for (let amount = 100; amount < 109; amount++) {
    const result = await app.plan(`Draft a ${amount} EUR invoice for the design client for services.`);
    first ??= result.proposal;
  }
  const updated = await app.plan('Change the 100 EUR invoice to 150 EUR.');
  assert.equal(updated.proposal.id, first.id); assert.equal(updated.proposal.revision, 2);
  await app.plan('Draft a separate 150 EUR invoice for the design client for consultation.');
  const ambiguous = await app.plan('Change the 150 EUR invoice to 200 EUR.');
  assert.equal(ambiguous.plan.intent, 'clarify'); assert.equal(ambiguous.proposal, null);
  assert.equal(app.proposals().find(p => p.id === first.id).revision, 2);
});

test('OpenCode Go requests identify this client and keep one stable conversation ID', async () => {
  const headers = [];
  const planner = new ModelPlanner({ baseUrl: 'https://opencode.ai/inference/go/openai/v1', apiKey: 'test-only', model: 'deepseek-v4.1-flash',
    fetchImpl: async (_url, options) => { headers.push(options.headers); return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(existing('design')) } }] }); } });
  await planner.route('Design note.', topics); await planner.route('Another design note.', topics);
  assert.equal(headers.length, 2);
  assert.equal(headers[0]['User-Agent'], 'theone-invoice-desk/0.4.6');
  assert.match(headers[0]['x-opencode-session'], /^[a-f0-9-]{36}$/);
  assert.equal(headers[1]['x-opencode-session'], headers[0]['x-opencode-session']);
});

test('a guessed customer is blocked before planning; an explicit answer preserves the original invoice', async t => {
  for (const message of ['Draft a 480 EUR invoice for that client for project services.', 'Draft a 480 EUR invoice for project services.', '给那个客户开一张 480 EUR 的服务发票。']) {
    let plans = 0, routes = 0;
    const planner = { ...previewPlanner, async route(...args) {
      if (++routes === 1) return { model: 'mock', decision: existing('design'), trace: { final: existing('design'), calls: [] } };
      return previewPlanner.route(...args);
    }, async plan(...args) { plans++; return previewPlanner.plan(...args); } };
    const app = new InvoiceWorkflow({ topics, planner, paypal: previewPayPal() }); t.after(() => app.close());
    const first = await app.plan(message);
    assert.equal(first.plan.intent, 'clarify'); assert.equal(first.route.customerGuard, 'unbound-customer');
    assert.equal(first.route.trace.modelFinal.contextId, 'design'); assert.equal(first.route.trace.final.action, 'CLARIFY');
    assert.equal(plans, 0); assert.equal(app.proposals().length, 0);
    const resolved = await app.plan('The design client.');
    assert.equal(resolved.proposal.topic_id, 'design'); assert.equal(resolved.proposal.payload.items[0].unit_amount.value, '480.00');
    assert.equal(plans, 1);
  }
});

test('customer clarification and invoice outcomes stay English even if the model switches languages', async t => {
  let turn = 0, edits = false, current;
  const planner = { async route() {
    if (++turn === 1) return { model: 'mock', decision: { action: 'CLARIFY', contextId: null, reason: 'Ambiguous', candidateIds: ['design', 'move'], question: '您指哪位客户？' } };
    return { model: 'mock', decision: { ...existing('design'), resolvesQuestion: turn === 2 } };
  }, async plan() { return { model: 'mock', plan: edits
    ? { intent: 'invoice_update', topic_id: 'design', amount: '520', currency: null, description: null, proposal_id: current.id, revision: current.revision, reply: '已发送更新后的发票。' }
    : { intent: 'invoice_draft', topic_id: 'design', amount: '480', currency: 'EUR', description: 'Services', reply: '已创建并发送发票。' } }; } };
  const app = new InvoiceWorkflow({ topics, planner, paypal: previewPayPal() }); t.after(() => app.close());
  const question = await app.plan('Draft a 480 EUR invoice for that client for services.');
  assert.match(question.plan.reply, /Do you mean Design client or Moving project/);
  const draft = await app.plan('The design client.'); current = draft.proposal;
  assert.match(draft.plan.reply, /Draft prepared for review/); assert.equal(current.state, 'REVIEW');
  edits = true;
  const revised = await app.plan('Make it 520 EUR.');
  assert.match(revised.plan.reply, /Updated the local draft/); assert.equal(revised.proposal.state, 'REVIEW');
});
