// Regression tests use explicit provider stubs; they do not measure model routing accuracy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvoiceWorkflow } from './workflow.mjs';
import { ModelPlanner } from './adapters.mjs';
import { validateRoute, routingPayload, INVOICE_ROUTING_PROMPT } from './routing.mjs';
import { previewTopics, previewPlanner, previewPayPal } from './preview.mjs';

function fixture(t, planner = previewPlanner, database) {
  let creates = 0;
  const paypal = previewPayPal(), create = paypal.createDraft;
  paypal.createDraft = async p => { creates++; return create(p); };
  const app = new InvoiceWorkflow({ topics: previewTopics, planner, paypal, database });
  t.after(() => app.close());
  return { app, creates: () => creates };
}
const draft = '给设计客户开一张 480 EUR 的网站素材发票草稿。';

test('English demo supports project switching, invoice details and notes-only expenses', async t => {
  const { app, creates } = fixture(t);
  assert.equal((await app.plan('Draft an invoice for the design client.')).plan.intent, 'clarify');
  const invoice = await app.plan('480 EUR for website assets.');
  assert.equal(invoice.proposal.payload.items[0].unit_amount.value, '480.00');
  assert.equal(invoice.proposal.payload.items[0].name, 'Website design assets');
  assert.equal((await app.plan('Continue with Moving project.')).route.topicId, 'move');
  assert.equal((await app.plan('Record 72 EUR of moving expenses in my household budget. No invoice.')).route.topicId, 'budget');
  assert.equal(app.proposals('budget').length, 0);
  assert.equal((await app.plan('Continue with Design client.')).route.topicId, 'design');
  assert.equal(app.proposals().length, 1);
  assert.equal(creates(), 0);
});

test('English ambiguous-client answer preserves the original invoice details', async t => {
  const { app, creates } = fixture(t);
  await app.plan('Draft a 480 EUR invoice for the design client for website assets.');
  assert.equal((await app.plan('Draft a 72 EUR invoice for that client for project services.')).route.action, 'CLARIFY');
  const result = await app.plan('The moving project.');
  assert.equal(result.route.resolvesQuestion, true);
  assert.equal(result.proposal.topic_id, 'move');
  assert.equal(result.proposal.payload.items[0].unit_amount.value, '72.00');
  assert.equal(creates(), 0);
});

test('topic continuation has server-owned context, separate histories, and no implicit approval', async t => {
  const contexts = [], planning = [];
  const planner = { ...previewPlanner,
    async route(message, topics, context) { contexts.push(structuredClone({ ...context, onCall: undefined, validatePlan: undefined })); return previewPlanner.route(message, topics, context); },
    async plan(message, topics, context) { planning.push(structuredClone({ ...context, onCall: undefined, validatePlan: undefined })); return previewPlanner.plan(message, topics, context); } };
  const { app, creates } = fixture(t, planner);
  assert.equal((await app.plan(draft)).route.transition, 'MOUNT');
  assert.equal((await app.plan('把 72 EUR 的搬家花费记到家庭预算，不要开发票。')).route.transition, 'SWAP');
  const result = await app.plan('继续刚才那个设计项目。');
  assert.equal(result.route.topicId, 'design');
  assert.ok(planning.at(-1).recent.every(m => m.topic_id === 'design'));
  assert.ok(!JSON.stringify(planning.at(-1)).includes('72 EUR'));
  assert.equal(contexts.at(-1).currentId, 'budget');
  assert.equal(contexts.at(-1).attention.pending[0].kind, 'approval');
  assert.equal((await app.plan('确认，继续')).route.transition, 'KEEP');
  assert.equal(app.proposals().length, 1); assert.equal(creates(), 0);
});

test('clarification keeps the known topic and follows up with earlier user-provided details', async t => {
  const { app, creates } = fixture(t);
  const incomplete = await app.plan('给设计客户开一张发票。');
  assert.equal(incomplete.plan.intent, 'clarify'); assert.equal(incomplete.route.topicId, 'design');
  const result = await app.plan('金额 480 EUR，网站素材。');
  assert.equal(result.route.transition, 'KEEP'); assert.equal(result.proposal.topic_id, 'design');
  assert.equal(result.proposal.payload.items[0].unit_amount.value, '480.00'); assert.equal(creates(), 0);
});

test('ambiguous topic asks without calling the invoice planner or creating state', async t => {
  let plans = 0;
  const { app } = fixture(t, { ...previewPlanner, async plan() { plans++; throw Error('should not plan'); } });
  const result = await app.plan('给之前那个客户开一张发票。');
  assert.equal(result.route.action, 'CLARIFY'); assert.equal(result.proposal, null);
  assert.equal(plans, 0); assert.equal(app.routingState().currentId, null);
  assert.equal(app.messages().length, 2);
});

test('correction memory, moved conversation, topics and current context survive restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'invoice-routing-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, 'desk.sqlite');
  let app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), database });
  const original = (await app.plan(draft)).proposal;
  app.correct(original.id, original.revision, 'move');
  assert.equal(app.messages('design').length, 0); assert.equal(app.messages('move').length, 2);
  assert.equal(app.messages('move')[0].route.corrected, true);
  app.close();
  app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), database });
  t.after(() => app.close());
  assert.equal(app.routingState().currentId, 'move'); assert.equal(app.routingState().correctionCount, 1);
  assert.equal((await app.plan(draft)).route.topicId, 'move');
  await assert.rejects(app.approve(original.id, original.digest), /Review changed/);
});

test('correcting an older proposal does not steal the foreground topic', async t => {
  const { app } = fixture(t);
  const p = (await app.plan(draft)).proposal;
  await app.plan('把 72 EUR 的搬家花费记到家庭预算，不要开发票。');
  app.correct(p.id, p.revision, 'move');
  assert.equal(app.routingState().currentId, 'budget');
});

test('CREATE is a persisted notes-only topic, without invented recipients or invoice capability', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'invoice-new-topic-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, 'desk.sqlite');
  let app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), database });
  const result = await app.plan('安排日本旅行的行程。');
  const id = result.route.topicId;
  assert.equal(result.route.action, 'CREATE'); assert.equal(result.proposal, null);
  assert.equal(app.topics().find(t => t.id === id).invoice_enabled, false);
  app.close();
  app = new InvoiceWorkflow({ topics: previewTopics, planner: previewPlanner, paypal: previewPayPal(), database }); t.after(() => app.close());
  assert.equal((await app.plan('继续日本旅行的行程。')).route.topicId, id);
  assert.equal(app.topics().length, 4);
});

test('explicit cross-topic references are bounded and do not carry recipients', async t => {
  let input;
  const { app } = fixture(t, { ...previewPlanner, async plan(m, topics, context) { input = context; return previewPlanner.plan(m, topics, context); } });
  await app.plan(draft); await app.plan('参考设计项目，整理家庭预算。');
  assert.deepEqual(input.references.map(t => t.id), ['design']);
  assert.ok(!JSON.stringify(input.references).includes('design-buyer@example.invalid'));
  assert.equal(app.proposals('budget').length, 0);
});

test('invoice planner cannot redirect the route or create invoices from notes-only topics', async t => {
  const { app } = fixture(t, { ...previewPlanner, async plan() { return { model: 'mock', plan: { intent: 'invoice_draft', topic_id: 'move', amount: '72', currency: 'EUR', description: 'Fake', reply: '' } }; } });
  await assert.rejects(app.plan(draft), /changed the routed topic/);
  assert.equal(app.proposals().length, 0); assert.equal(app.messages().length, 0);
});

test('invalid routes cannot mutate conversation, current topic or proposals', async t => {
  const { app } = fixture(t, { ...previewPlanner, async route() { return { decision: { action: 'EXISTING', contextId: 'invented', reason: 'bad' } }; } });
  await assert.rejects(app.plan(draft), /Invalid routing target/);
  assert.equal(app.messages().length, 0); assert.equal(app.proposals().length, 0);
  assert.equal(app.routingState().currentId, null);
  for (const patch of [{ relatedIds: ['missing'] }, { relatedIds: ['design'] }, { candidateIds: ['design'] }]) {
    assert.throws(() => validateRoute({ action: 'EXISTING', contextId: 'design', reason: 'test', ...patch }, previewTopics));
  }
});

test('simultaneous messages are routed in order using completed foreground state', async t => {
  const currents = [];
  const { app } = fixture(t, { ...previewPlanner, async route(m, topics, context) { currents.push(context.currentId); await new Promise(r => setTimeout(r, 10)); return previewPlanner.route(m, topics, context); } });
  const results = await Promise.all([app.plan(draft), app.plan('继续')]);
  assert.deepEqual(currents, [null, 'design']); assert.equal(results[1].route.transition, 'KEEP');
  assert.equal(app.proposals().length, 1);
});

test('correction during an in-flight model call rejects the stale decision without a new draft', async t => {
  let block = false, release, entered;
  const started = new Promise(r => { entered = r; });
  const { app } = fixture(t, { ...previewPlanner, async route(m, topics, context) {
    if (block) { entered(); await new Promise(r => { release = r; }); }
    return previewPlanner.route(m, topics, context);
  } });
  const original = (await app.plan(draft)).proposal;
  block = true; const pending = app.plan(draft); await started;
  app.correct(original.id, original.revision, 'move'); release();
  await assert.rejects(pending, /context changed/);
  assert.equal(app.proposals().length, 1); assert.equal(app.routingState().currentId, 'move');
});

test('model adapter sends the 0.4.6 semantic prompt and bounded redacted state in a separate call', async () => {
  const calls = [];
  const planner = new ModelPlanner({ baseUrl: 'https://model.example.invalid/v1', apiKey: 'mock', model: 'mock', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const value = calls.length === 1 ? { action: 'EXISTING', contextId: 'design', reason: 'test' }
      : { intent: 'chat', topic_id: 'design', amount: null, currency: null, description: null, reply: 'Saved' };
    return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  } });
  const routed = await planner.route('Email client@example.invalid', previewTopics, { currentId: 'design', recent: [{ role: 'user', text: 'secret@example.invalid' }] });
  assert.equal(routed.decision.contextId, 'design'); assert.equal(calls[0].messages[0].content, INVOICE_ROUTING_PROMPT);
  const payload = JSON.parse(calls[0].messages[1].content);
  assert.equal(payload.currentId, 'design'); assert.ok(payload.text.includes('[email]'));
  assert.ok(!JSON.stringify(calls).includes('@example.invalid'));
  await planner.plan('Note', previewTopics, { topicId: 'design', recent: [] });
  assert.equal(JSON.parse(calls[1].messages[1].content).catalog.length, 1);
  assert.equal(JSON.parse(calls[1].messages[1].content).catalog[0].id, 'design');
});

test('routing payload is bounded with a full catalog and long recent messages/corrections', () => {
  const topics = Array.from({ length: 32 }, (_, i) => ({ id: 'topic-'+i, title: 't'.repeat(100), summary: 's'.repeat(500) }));
  const payload = routingPayload('m'.repeat(4000), topics, { recent: Array.from({ length: 30 }, () => ({ role: 'user', text: 'r'.repeat(4000) })),
    corrections: Array.from({ length: 20 }, () => ({ text: 'c'.repeat(4000), wrongId: 'topic-0', rightId: 'topic-1' })) });
  assert.ok(JSON.stringify(payload).length <= 24000);
  assert.equal(payload.contexts.length, 32); assert.equal(payload.text.length, 4000);
});

test('answering a routing question binds the original request and amount to the chosen topic', async t => {
  const { app, creates } = fixture(t);
  const first = await app.plan('给之前那个客户开一张 480 EUR 的网站素材发票。');
  assert.equal(first.route.action, 'CLARIFY');
  const answer = await app.plan('设计客户。');
  assert.equal(answer.route.resolvesQuestion, true);
  assert.equal(answer.proposal.payload.items[0].unit_amount.value, '480.00');
  assert.equal(app.messages('design').length, 4); assert.equal(creates(), 0);
});

test('unrelated new requests cannot inherit invoice details from an unresolved question', async t => {
  let received;
  const { app } = fixture(t, { ...previewPlanner, async plan(m, topics, context) {
    received = context; return previewPlanner.plan(m, topics, context);
  } });
  await app.plan('给之前那个客户开一张 480 EUR 的网站素材发票。');
  await app.plan('把搬家支出记入家庭预算。');
  assert.ok(!JSON.stringify(received.recent).includes('480'));
  assert.equal(app.proposals().length, 0);
});

test('temporary return context survives a follow-up within the aside topic', async t => {
  let calls = 0, lastContext;
  const { app } = fixture(t, { ...previewPlanner, async route(m, topics, context) {
    lastContext = context; calls++;
    if (calls === 2) return { model:'mock', decision:{ action:'CREATE', contextId:null, title:'单位换算', historyIndependent:true, aside:true, reason:'一次性插问' } };
    if (calls === 3) return { model:'mock', decision:{ action:'EXISTING', contextId:context.currentId, reason:'插问的补充' } };
    return previewPlanner.route(m, topics, context);
  } });
  await app.plan(draft); await app.plan('换算一个数'); await app.plan('再解释一下');
  assert.equal(app.routingState().foreground.returnTopicId, 'design');
  assert.equal(lastContext.attention.foreground.returnTopicId, 'design');
});

test('correcting a clarified proposal moves the entire clarification exchange with it', async t => {
  const { app } = fixture(t);
  await app.plan('给之前那个客户开一张 480 EUR 的网站素材发票。');
  const p = (await app.plan('设计客户。')).proposal;
  app.correct(p.id, p.revision, 'move');
  assert.equal(app.messages('design').length, 0);
  assert.equal(app.messages('move').length, 4);
  assert.ok(app.messages('move').every(m => m.route.corrected));
  assert.equal(app.proposals('move')[0].payload.primary_recipients[0].billing_info.email_address, 'move-buyer@example.invalid');
});
