import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { validateRoute, guardCustomerRoute, redact } from './routing.mjs';
import { selectDraft } from './invoice-selection.mjs';
import { AppError, PayPalError } from './errors.mjs';
import { groundMoney } from './invoice-input.mjs';

const currencies = new Set(['USD', 'EUR', 'GBP']);
export function money(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})(\.\d{1,2})?$/.test(value)) throw new Error('Amount must be an exact decimal string');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1 || cents > 1_000_000) throw new Error('Sandbox amount must be between 0.01 and 10000.00');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reviewDigest = (payload, revision) => hash({ revision, payload });
function invoiceFields(payload) {
  return { project: payload.detail.reference, recipient: payload.primary_recipients[0].billing_info.email_address,
    amount: payload.items[0].unit_amount.value, currency: payload.items[0].unit_amount.currency_code,
    description: payload.items[0].name };
}
function changesBetween(before, after) {
  const a = invoiceFields(before), b = invoiceFields(after);
  return Object.keys(b).filter(key => a[key] !== b[key]).map(field => ({ field, before: a[field], after: b[field] }));
}
function revisionPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length ||
      Object.keys(value).some(k => !['amount', 'currency', 'description'].includes(k))) throw Error('Invalid invoice changes');
  const result = {};
  if ('amount' in value) result.amount = money(value.amount);
  if ('currency' in value) {
    if (!currencies.has(value.currency)) throw Error('Unsupported invoice currency');
    result.currency = value.currency;
  }
  if ('description' in value) result.description = text(value.description, 200, 'invoice description');
  return result;
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Invalid configured Sandbox recipient');
  return value;
}
export function validatePlan(plan, topics) {
  const keys = ['intent', 'topic_id', 'amount', 'currency', 'description', 'reply'].sort();
  const extended = [...keys, 'proposal_id', 'revision'].sort();
  if (!plan || Array.isArray(plan) || typeof plan !== 'object' ||
      ![JSON.stringify(keys), JSON.stringify(extended)].includes(JSON.stringify(Object.keys(plan).sort()))) throw new Error('Unexpected model plan schema');
  if (typeof plan.reply !== 'string' || plan.reply.length > 1000) throw new Error('Invalid model reply');
  if (!['chat', 'invoice_draft', 'invoice_update', 'invoice_status', 'clarify'].includes(plan.intent)) throw new Error('Unknown model intent');
  if (plan.intent !== 'invoice_update' && (plan.proposal_id != null || plan.revision != null)) throw Error('Unexpected revision target');
  if (plan.intent === 'clarify') {
    if (plan.topic_id !== null) throw new Error('Clarification cannot select a topic');
  } else if (!topics.some(t => t.id === plan.topic_id)) throw new Error('Unknown model topic');
  if (plan.intent === 'invoice_update') {
    text(plan.proposal_id, 100, 'proposal ID');
    if (!Number.isSafeInteger(plan.revision) || plan.revision < 1) throw Error('Invalid invoice revision');
    const patch = revisionPatch(Object.fromEntries(['amount', 'currency', 'description']
      .filter(k => plan[k] !== null).map(k => [k, plan[k]])));
    return { ...plan, ...patch };
  }
  if (plan.intent === 'invoice_draft') {
    if (!currencies.has(plan.currency)) throw new Error('Unsupported invoice currency');
    return { ...plan, amount: money(plan.amount), description: text(plan.description, 200, 'invoice description') };
  }
  text(plan.reply, 1000, 'model reply');
  if ([plan.amount, plan.currency, plan.description].some(v => v !== null)) throw new Error('Non-invoice plan cannot contain invoice fields');
  return plan;
}

export class InvoiceWorkflow {
  #db; #topics; #planner; #paypal; #queue = Promise.resolve(); #epoch = 0;
  #activeCreates = new Set(); #recoveries = new Map(); #remoteLocks = new Set();
  constructor({ database = ':memory:', topics, planner, paypal }) {
    if (!Array.isArray(topics) || !topics.length || topics.length > 16) throw new Error('Configure 1–16 topics');
    const ids = new Set();
    this.#topics = topics.map(t => {
      if (!/^[a-z0-9_-]{1,40}$/.test(t.id) || ids.has(t.id)) throw new Error('Invalid or duplicate topic ID');
      ids.add(t.id);
      if (t.aliases !== undefined && (!Array.isArray(t.aliases) || t.aliases.length > 8)) throw Error('Invalid project aliases');
      return { id: t.id, title: text(t.title, 100, 'topic title'), summary: text(t.summary, 500, 'topic summary'),
        ...(t.aliases?.length ? { aliases: t.aliases.map(a => text(a, 100, 'project alias')) } : {}),
        recipient: email(t.recipient), invoice_enabled: t.invoice_enabled !== false };
    });
    this.#planner = planner; this.#paypal = paypal;
    this.#db = new DatabaseSync(database);
    this.#db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS proposals(
      id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, revision INTEGER NOT NULL,
      state TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
      model TEXT NOT NULL, remote_id TEXT, failure TEXT, created_at TEXT NOT NULL
    )`);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS desk_topics (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS desk_messages (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        topic_id TEXT, role TEXT NOT NULL, text TEXT NOT NULL, route TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS desk_corrections (n INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, wrong_id TEXT, right_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS desk_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposal_messages (proposal_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reply_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposal_context (proposal_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(proposal_id,message_id));
      CREATE TABLE IF NOT EXISTS invoice_versions (proposal_id TEXT NOT NULL, revision INTEGER NOT NULL,
        payload TEXT NOT NULL, digest TEXT NOT NULL, cause TEXT NOT NULL, source_ids TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(proposal_id,revision));
      CREATE TABLE IF NOT EXISTS invoice_events (n INTEGER PRIMARY KEY AUTOINCREMENT, proposal_id TEXT NOT NULL,
        kind TEXT NOT NULL, revision INTEGER NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS invoice_events_proposal ON invoice_events(proposal_id,n);
      CREATE TABLE IF NOT EXISTS plan_requests (request_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL,
        result TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS planning_attempts (id TEXT PRIMARY KEY, request_id TEXT, message TEXT NOT NULL,
        status TEXT NOT NULL, route TEXT, calls TEXT NOT NULL, error_code TEXT, error_message TEXT, elapsed_ms INTEGER,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_operations (proposal_id TEXT PRIMARY KEY, operation TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_status (proposal_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
      UPDATE planning_attempts SET status='INTERRUPTED',error_code='PROCESS_INTERRUPTED'
        WHERE status='RUNNING';`);
    // Additive migration: preserve current records without inventing historical revisions.
    this.#transaction(() => {
      for (const row of this.#db.prepare('SELECT * FROM proposals WHERE id NOT IN (SELECT proposal_id FROM invoice_versions)').all()) {
        this.#snapshot(row, 'legacy_snapshot', []);
      }
    });
    const extra = this.#db.prepare('SELECT value FROM desk_topics ORDER BY rowid').all().map(r => JSON.parse(r.value));
    for (const topic of extra) if (!ids.has(topic.id)) { this.#topics.push(topic); ids.add(topic.id); }
  }
  #transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #setting(key) { const row = this.#db.prepare('SELECT value FROM desk_state WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  #set(key, value) { this.#db.prepare('INSERT OR REPLACE INTO desk_state VALUES (?,?)').run(key, JSON.stringify(value)); }
  #event(row, kind, details = {}) {
    this.#db.prepare('INSERT INTO invoice_events(proposal_id,kind,revision,details,created_at) VALUES (?,?,?,?,?)')
      .run(row.id, kind, row.revision, JSON.stringify(details), new Date().toISOString());
  }
  #snapshot(row, cause, sourceIds, before) {
    this.#db.prepare('INSERT INTO invoice_versions VALUES (?,?,?,?,?,?,?)')
      .run(row.id, row.revision, row.payload, row.digest, cause, JSON.stringify(sourceIds), new Date().toISOString());
    this.#event(row, cause, { source_message_ids: sourceIds,
      changes: before ? changesBetween(JSON.parse(before.payload), JSON.parse(row.payload)) : [] });
  }
  history(id) {
    const proposal = this.#public(this.#row(id));
    const versions = this.#db.prepare('SELECT * FROM invoice_versions WHERE proposal_id=? ORDER BY revision').all(id)
      .map(r => ({ revision: r.revision, digest: r.digest, cause: r.cause, fields: invoiceFields(JSON.parse(r.payload)),
        source_message_ids: JSON.parse(r.source_ids), created_at: r.created_at }));
    const events = this.#db.prepare('SELECT * FROM invoice_events WHERE proposal_id=? ORDER BY n').all(id)
      .map(r => ({ ...r, details: JSON.parse(r.details) }));
    return { proposal, versions, events };
  }
  review(id) {
    const history = this.history(id), p = history.proposal, previous = history.versions.at(-2);
    const current = invoiceFields(p.payload);
    return { id: p.id, revision: p.revision, digest: p.digest, state: p.state,
      invoice_number: p.payload.detail.invoice_number, fields: current,
      changes: previous ? Object.keys(current).filter(k => previous.fields[k] !== current[k])
        .map(field => ({ field, before: previous.fields[field], after: current[field] })) : [],
      can_create: p.state === 'REVIEW', can_reconcile: ['CREATING', 'VERIFYING', 'UNCERTAIN', 'ARCHIVED_UNCERTAIN'].includes(p.state),
      can_discard: ['REVIEW','UNCERTAIN'].includes(p.state),
      effects: ['create_unsent_sandbox_draft', 'read_and_verify'], sends_invoice: false };
  }
  brief(topicId) {
    const topic = this.#topics.find(t => t.id === topicId);
    if (!topic) throw Error('Unknown topic');
    const proposals = this.proposals(topicId);
    const categories = { awaiting_review: 'REVIEW', verified_drafts: 'CREATED' };
    const groups = {};
    for (const category of [...Object.keys(categories), 'needs_verification']) {
      const rows = proposals.filter(p => categories[category] ? p.state === categories[category] : ['CREATING','VERIFYING','UNCERTAIN','REMOTE_PENDING','REMOTE_UNCERTAIN'].includes(p.state));
      const totals = new Map();
      for (const p of rows) {
        const { currency_code, value } = p.payload.items[0].unit_amount;
        const cents = BigInt(value.replace('.', ''));
        totals.set(currency_code, (totals.get(currency_code) ?? 0n) + cents);
      }
      groups[category] = { count: rows.length, totals: [...totals].sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, cents]) => ({ currency, amount: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` })) };
    }
    const labels = { awaiting_review: 'Awaiting review', verified_drafts: 'Verified unsent drafts', needs_verification: 'Needs verification' };
    const lines = Object.entries(groups).map(([key, g]) => `${labels[key]}: ${g.count}${g.count ? ' (' + g.totals.map(t => t.amount + ' ' + t.currency).join(', ') + ')' : ''}.`);
    return { topic_id: topicId, title: topic.title, invoice_enabled: topic.invoice_enabled, ...groups,
      discarded_count: proposals.filter(p => p.state === 'DISCARDED').length,
      archived_uncertain_count: proposals.filter(p => p.state === 'ARCHIVED_UNCERTAIN').length,
      deleted_count: proposals.filter(p => p.state === 'DELETED').length,
      remote_statuses: proposals.flatMap(p => { const r = this.#db.prepare('SELECT snapshot FROM remote_status WHERE proposal_id=?').get(p.id); return r ? [{ proposal_id: p.id, ...JSON.parse(r.snapshot) }] : []; }),
      source: 'local_invoice_records', as_of: new Date().toISOString(),
      note: 'Verified means the last successful PayPal draft read. This is not a live balance, payment or delivery status.',
      text: `${topic.title}\n${topic.invoice_enabled ? lines.join('\n') : 'Notes only. No customer invoices.'}${proposals.some(p => p.state === 'ARCHIVED_UNCERTAIN') ? '\nArchived attempts still have unresolved remote outcomes; archiving did not cancel them in PayPal.' : ''}${proposals.some(p => p.state === 'REMOTE_ACTIVE') ? '\nPayable or completed remote invoices: ' + proposals.filter(p => p.state === 'REMOTE_ACTIVE').length + '. Refresh remote status for current payment information.' : ''}\nNo invoice emails are sent by this app.` };
  }
  messages(topicId, limit = 80) {
    const rows = topicId === undefined
      ? this.#db.prepare('SELECT * FROM desk_messages ORDER BY n DESC LIMIT ?').all(limit)
      : this.#db.prepare('SELECT * FROM desk_messages WHERE topic_id=? ORDER BY n DESC LIMIT ?').all(topicId, limit);
    return rows.reverse().map(row => ({ ...row, route: row.route ? JSON.parse(row.route) : null }));
  }
  routingState() {
    const current = this.#setting('currentId');
    return { version: '0.4.6', currentId: this.#topics.some(t => t.id === current) ? current : null,
      foreground: this.#setting('foreground'), correctionCount: this.#db.prepare('SELECT COUNT(*) AS n FROM desk_corrections').get().n };
  }
  attempts() {
    return this.#db.prepare('SELECT * FROM planning_attempts ORDER BY rowid DESC LIMIT 500').all()
      .map(r => ({ ...r, route: r.route ? JSON.parse(r.route) : null, calls: JSON.parse(r.calls) }));
  }
  routingMetrics() {
    const attempts = this.attempts();
    const routes = attempts.map(r => r.route).filter(Boolean), traced = routes.filter(r => r.trace);
    const calls = attempts.flatMap(r => r.calls.length ? r.calls : r.route?.trace?.calls ?? []);
    const latencies = attempts.map(r => r.elapsed_ms).filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = p => latencies.length ? latencies[Math.ceil(latencies.length * p) - 1] : null;
    const sum = field => calls.reduce((n, c) => n + (c[field] ?? 0), 0);
    return { scope: 'Last 500 planning attempts since attempt journaling was introduced; routing AND planning calls, including failures. Replays excluded.',
      turns: attempts.length, successful_turns: attempts.filter(a => a.status === 'SUCCEEDED').length,
      failed_turns: attempts.filter(a => a.status === 'FAILED').length,
      interrupted_turns: attempts.filter(a => a.status === 'INTERRUPTED').length,
      running_turns: attempts.filter(a => a.status === 'RUNNING').length,
      traced_turns: traced.length, uninstrumented_turns: attempts.length - traced.length,
      routing_calls: calls.filter(c => c.layer !== 'plan').length, planning_calls: calls.filter(c => c.layer === 'plan').length,
      continuation_turns: traced.filter(r => r.trace.tier === 'continuation').length,
      rechecks: traced.filter(r => r.trace.recheck?.attempted).length,
      accepted_rechecks: traced.filter(r => r.trace.recheck?.accepted).length,
      clarification_turns: traced.filter(r => r.action === 'CLARIFY').length,
      calls: calls.length, retries: calls.filter(c => c.attempt > 1).length, failed_calls: calls.filter(c => c.error).length,
      usage_reported_calls: calls.filter(c => c.promptTokens !== undefined && c.completionTokens !== undefined).length,
      prompt_tokens: sum('promptTokens'), completion_tokens: sum('completionTokens'), cache_hit_tokens: sum('cacheHitTokens'),
      latency_ms: { p50: percentile(0.5), p95: percentile(0.95) },
      note: 'Operational observations, not a routing accuracy benchmark. Scripted preview turns have no model trace.' };
  }
  #context() {
    const state = this.routingState();
    const pending = this.#db.prepare("SELECT id,topic_id FROM proposals WHERE state='REVIEW' ORDER BY created_at DESC LIMIT 9").all();
    return { currentId: state.currentId, pendingQuestion: this.#setting('pendingQuestion'), recent: this.messages(undefined, 12),
      // Kept local: only matching evidence terms enter a second model call.
      memories: this.#topics.map(t => ({ id: t.id, texts: this.messages(t.id, 32).filter(m => m.role === 'user').map(m => m.text) })),
      states: this.#topics.map(t => ({ id: t.id, activity: this.messages(t.id, 1)[0]?.created_at, status: pending.some(p => p.topic_id === t.id) ? 'waiting' : 'active' })),
      corrections: this.#db.prepare('SELECT text,wrong_id AS wrongId,right_id AS rightId FROM desk_corrections ORDER BY n DESC LIMIT 12').all().reverse(),
      attention: { ...(state.foreground ? { foreground: state.foreground } : {}), background: [],
        pending: pending.slice(0, 8).map(p => ({ id: p.id, topicId: p.topic_id, kind: 'approval' })), pendingOverflow: pending.length > 8 } };
  }
  close() { this.#db.close(); }
  topics() { return this.#topics.map(({ recipient, ...t }) => t); }
  proposals(topicId) {
    if (topicId !== undefined && !this.#topics.some(t => t.id === topicId)) throw new Error('Unknown topic');
    const rows = topicId === undefined ? this.#db.prepare('SELECT * FROM proposals ORDER BY created_at DESC,rowid DESC').all()
      : this.#db.prepare('SELECT * FROM proposals WHERE topic_id=? ORDER BY created_at DESC,rowid DESC').all(topicId);
    return rows.map(row => this.#public(row));
  }
  #row(id) {
    const row = this.#db.prepare('SELECT * FROM proposals WHERE id=?').get(id);
    if (!row) throw new Error('Unknown proposal');
    return row;
  }
  #public(row) { return { ...row, payload: JSON.parse(row.payload), revision: Number(row.revision) }; }
  #payload(id, plan) {
    const topic = this.#topics.find(t => t.id === plan.topic_id);
    if (!topic.invoice_enabled) throw new Error('This topic is for notes, not customer invoices');
    return {
      detail: { currency_code: plan.currency, invoice_number: `TO-${id.replaceAll('-', '').slice(0, 20)}`,
        reference: topic.id, memo: `TheOne Sandbox topic: ${topic.title}`, payment_term: { term_type: 'NO_DUE_DATE' } },
      primary_recipients: [{ billing_info: { email_address: topic.recipient } }],
      items: [{ name: plan.description, quantity: '1', unit_amount: { currency_code: plan.currency, value: plan.amount } }],
      configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
    };
  }
  plan(message, requestId) {
    const run = this.#queue.then(async () => {
      const input = text(message, 4000, 'message');
      const attempt = { id: randomUUID(), calls: [], started: performance.now() };
      // Replays are not new attempts. A failed attempt never claims the replay key.
      if (typeof requestId === 'string' && this.#db.prepare('SELECT 1 FROM plan_requests WHERE request_id=?').get(requestId))
        return this.#plan(input, requestId, attempt);
      this.#db.prepare('INSERT INTO planning_attempts VALUES (?,?,?,\'RUNNING\',NULL,\'[]\',NULL,NULL,NULL,?)')
        .run(attempt.id, typeof requestId === 'string' ? requestId : null, redact(input), new Date().toISOString());
      try {
        const result = await this.#plan(input, requestId, attempt);
        this.#db.prepare("UPDATE planning_attempts SET status='SUCCEEDED',route=?,calls=?,elapsed_ms=? WHERE id=?")
          .run(JSON.stringify(result.route), JSON.stringify(attempt.calls), Math.round(performance.now()-attempt.started), attempt.id);
        return result;
      } catch (error) {
        this.#db.prepare("UPDATE planning_attempts SET status='FAILED',route=?,calls=?,error_code=?,error_message=?,elapsed_ms=? WHERE id=?")
          .run(attempt.route ? JSON.stringify(attempt.route) : null, JSON.stringify(attempt.calls), error.code ?? 'PLANNING_FAILED',
            redact(error.message).slice(0,500), Math.round(performance.now()-attempt.started), attempt.id);
        error.attemptId = attempt.id; throw error;
      }
    });
    this.#queue = run.catch(() => {});
    return run;
  }
  async #plan(message, requestId, attempt) {
    message = text(message, 4000, 'message');
    if (requestId !== undefined) {
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw Error('Invalid request ID');
      const cached = this.#db.prepare('SELECT * FROM plan_requests WHERE request_id=?').get(requestId);
      if (cached) {
        if (cached.input_hash !== hash(message)) throw Error('Request ID already used for a different message');
        const result = JSON.parse(cached.result);
        return { ...result, proposal: result.proposal ? this.#public(this.#row(result.proposal.id)) : null, replayed: true };
      }
    }
    const context = { ...this.#context(), onCall: call => attempt.calls.push(call) }, epoch = this.#epoch;
    const routed = await this.#planner.route(message, this.topics(), context);
    let route = validateRoute(routed.decision, this.#topics, context.currentId);
    const customerGuard = guardCustomerRoute(message, this.#topics, context, route);
    if (customerGuard) route = validateRoute(customerGuard, this.#topics, context.currentId);
    if (route.action === 'CLARIFY') {
      const names = route.candidateIds.map(id => this.#topics.find(t => t.id === id)?.title).filter(Boolean);
      route = { ...route, question: names.length
        ? `Do you mean ${names.slice(0, 6).map(name => name.slice(0, 80)).join(' or ')}${names.length > 6 ? ', or another project' : ''}? Please name the project.`
        : 'Please name the client project, or provide the earlier request you mean.' };
    }
    attempt.route = { ...route, ...(routed.trace ? { trace: routed.trace } : {}) };
    let topic = this.#topics.find(t => t.id === route.contextId), newTopic;
    if (route.action === 'CREATE') {
      if (this.#topics.length >= 32) throw Error('Topic limit reached; use an existing project');
      newTopic = { id: `note-${randomUUID().slice(0, 8)}`, title: route.title,
        summary: message.slice(0, 500), invoice_enabled: false };
      topic = newTopic;
    }
    const pending = route.resolvesQuestion ? context.pendingQuestion : null;
    if (route.resolvesQuestion && !pending) throw Error('No pending question to resolve');
    const clarified = pending ? this.#db.prepare('SELECT role,text FROM desk_messages WHERE id IN (?,?) ORDER BY n')
      .all(pending.userId, pending.replyId) : [];
    let result;
    const drafts = topic && !newTopic ? this.proposals(topic.id).filter(p => p.state === 'REVIEW') : [];
    const selectedDraftId = selectDraft(message, drafts);
    const visibleDrafts = (selectedDraftId ? [...drafts.filter(p => p.id === selectedDraftId), ...drafts.filter(p => p.id !== selectedDraftId)] : drafts).slice(0, 8);
    const recent = [...(topic ? this.messages(topic.id, 12) : []), ...clarified];
    const draftContext = visibleDrafts.map(p => ({ id: p.id, revision: p.revision, invoice_number: p.payload.detail.invoice_number,
      amount: p.payload.items[0].unit_amount.value, currency: p.payload.items[0].unit_amount.currency_code, description: p.payload.items[0].name }));
    let grounding;
    const validateCandidate = value => {
      const checked = validatePlan(value, newTopic ? [...this.#topics, newTopic] : this.#topics);
      if (checked.topic_id !== null && checked.topic_id !== topic?.id) throw Error('Invoice planner changed the routed topic');
      if (['invoice_draft','invoice_update'].includes(checked.intent)) {
        if (!topic?.invoice_enabled) throw Error('This topic is for notes, not customer invoices');
        if (guardCustomerRoute(message, this.#topics, context, route, true)) throw new AppError('CUSTOMER_UNBOUND', 'Ask which customer this invoice is for.', 422);
        grounding = groundMoney(checked, message, recent, draftContext);
      }
      return checked;
    };
    if (route.action === 'CLARIFY') {
      result = { model: routed.model, plan: { intent: 'clarify', topic_id: null, amount: null, currency: null,
        description: null, reply: route.question } };
    } else {
      result = await this.#planner.plan(message, [this.topics().find(t => t.id === topic.id) ?? newTopic], { topicId: topic.id, recent,
        ...(pending ? { resolvedRequest: pending.message } : {}),
        drafts: draftContext, validatePlan: validateCandidate, onCall: context.onCall,
        draftsOverflow: drafts.length > 8, selectedDraftId,
        references: route.relatedIds.map(id => ({ ...this.topics().find(t => t.id === id), messages: this.messages(id, 4) })) });
    }
    let plan = validateCandidate(result.plan);
    if (plan.topic_id !== null && plan.topic_id !== topic?.id) throw Error('Invoice planner changed the routed topic');
    if (plan.intent === 'invoice_status') plan = { ...plan, reply: newTopic
      ? `${newTopic.title}\nNotes only. No customer invoices.\nNo invoices are sent by this app.` : this.brief(topic.id).text };
    if (epoch !== this.#epoch) throw Error('Routing context changed during planning; review the latest conversation and try again');
    if (['invoice_draft', 'invoice_update'].includes(plan.intent) && !topic?.invoice_enabled) throw Error('This topic is for notes, not customer invoices');
    if (plan.intent === 'invoice_update') {
      const target = visibleDrafts.find(p => p.id === plan.proposal_id);
      if (!target || target.topic_id !== topic.id) throw Error('Revision target must be a reviewable draft in this project');
      if (target.revision !== plan.revision) throw Error('Stale invoice revision');
      // Resolve against ALL local drafts, not just the eight supplied to the model.
      if (drafts.length > 1 && selectedDraftId !== target.id) {
        plan = { intent: 'clarify', topic_id: null, amount: null, currency: null, description: null,
          reply: 'Which draft should change? Name its service or original amount followed by "invoice", or use its invoice number, with the change: ' +
            drafts.slice(0, 8).map(p => `${p.payload.items[0].name.slice(0, 32)}: ${p.payload.items[0].unit_amount.value} ${p.payload.items[0].unit_amount.currency_code} (${p.payload.detail.invoice_number})`).join('; ') };
      }
    }
    // Business outcomes are owned by this workflow, not by a model's language or success claims.
    if (plan.intent === 'invoice_draft') plan = { ...plan,
      reply: 'Draft prepared for review. Check the client, recipient and amount before creating it in PayPal Sandbox.' };
    if (plan.intent === 'invoice_update') plan = { ...plan,
      reply: 'Updated the local draft. Review it again before creating it in PayPal Sandbox.' };
    const userId = randomUUID(), replyId = randomUUID(), now = new Date().toISOString();
    const receipt = { ...route, topicId: topic?.id ?? null, model: routed.model,
      attemptId: attempt.id, ...(grounding ? { grounding } : {}),
      version: '0.4.6', elapsedMs: routed.elapsedMs ?? null,
      ...(routed.trace ? { trace: { ...routed.trace, ...(customerGuard ? {
        modelFinal: routed.trace.final, customerGuard: 'unbound-customer', final: route } : {}) } } : {}),
      ...(customerGuard ? { customerGuard: 'unbound-customer' } : {}), ...(routed.usage ? { usage: routed.usage } : {}) };
    let proposal;
    this.#transaction(() => {
      if (pending) {
        this.#db.prepare('UPDATE desk_messages SET topic_id=? WHERE id IN (?,?)').run(topic.id, pending.userId, pending.replyId);
        this.#set('pendingQuestion', null);
      }
      if (route.action === 'CLARIFY') this.#set('pendingQuestion', { userId, replyId, message,
        question: route.question, candidateIds: route.candidateIds });
      if (newTopic) this.#db.prepare('INSERT INTO desk_topics VALUES (?,?)').run(newTopic.id, JSON.stringify(newTopic));
      if (plan.intent === 'invoice_draft') {
        const id = randomUUID(), payload = this.#payload(id, plan), digest = reviewDigest(payload, 1);
        const existing = this.#db.prepare(`SELECT p.* FROM proposals p JOIN proposal_messages pm ON pm.proposal_id=p.id
          JOIN desk_messages m ON m.id=pm.user_id WHERE p.topic_id=? AND m.text=? AND p.state NOT IN ('DISCARDED','DELETED')
          ORDER BY p.rowid DESC LIMIT 1`).get(plan.topic_id, message);
        if (existing) {
          proposal = this.#public(existing);
          plan = { ...plan, reply: 'This request already has an invoice record. Reusing it without creating another draft.' };
          this.#event(existing, 'duplicate_request_reused', { source_message_id: userId });
        } else {
        this.#db.prepare('INSERT INTO proposals VALUES (?,?,1,?,?,?,?,NULL,NULL,?)')
          .run(id, plan.topic_id, 'REVIEW', JSON.stringify(payload), digest, text(result.model, 200, 'model'), now);
        this.#db.prepare('INSERT INTO proposal_messages VALUES (?,?,?)').run(id, userId, replyId);
        if (pending) for (const messageId of [pending.userId, pending.replyId])
          this.#db.prepare('INSERT INTO proposal_context VALUES (?,?)').run(id, messageId);
        const row = this.#row(id);
        this.#snapshot(row, 'proposed', [userId, ...(pending ? [pending.userId] : [])]);
        proposal = this.#public(row);
        }
      } else if (plan.intent === 'invoice_update') {
        proposal = this.#revise(plan.proposal_id, plan.revision,
          Object.fromEntries(['amount', 'currency', 'description'].filter(k => plan[k] !== null).map(k => [k, plan[k]])),
          [userId], 'conversation_revision');
        for (const messageId of [userId, replyId]) this.#db.prepare('INSERT INTO proposal_context VALUES (?,?)').run(proposal.id, messageId);
      }
      const insert = this.#db.prepare('INSERT INTO desk_messages (id,topic_id,role,text,route,created_at) VALUES (?,?,?,?,?,?)');
      insert.run(userId, topic?.id ?? null, 'user', message, JSON.stringify(receipt), now);
      insert.run(replyId, topic?.id ?? null, 'assistant', plan.reply || 'Invoice proposal ready for review.', JSON.stringify(receipt), now);
      if (topic) {
        const front = context.attention.foreground;
        const returnTopicId = route.aside ? front?.returnTopicId ?? context.currentId
          : topic.id === front?.topicId ? front.returnTopicId : null;
        this.#set('currentId', topic.id);
        this.#set('foreground', { messageId: replyId, topicId: topic.id, ...(returnTopicId ? { returnTopicId } : {}) });
      }
      if (requestId !== undefined) this.#db.prepare('INSERT INTO plan_requests VALUES (?,?,?,?)')
        .run(requestId, hash(message), JSON.stringify({ ...result, plan, route: receipt, proposal: proposal ?? null }), now);
    });
    if (newTopic) this.#topics.push(newTopic);
    this.#epoch++;
    return { ...result, plan, route: receipt, proposal: proposal ?? null };
  }
  #revise(id, revision, changes, sourceIds, cause) {
    const row = this.#row(id);
    if (row.state !== 'REVIEW' || row.revision !== revision) throw Error('Stale review or immutable remote draft');
    const patch = revisionPatch(changes), payload = JSON.parse(row.payload);
    const item = payload.items[0];
    if (patch.amount !== undefined) item.unit_amount.value = patch.amount;
    if (patch.currency !== undefined) payload.detail.currency_code = item.unit_amount.currency_code = patch.currency;
    if (patch.description !== undefined) item.name = patch.description;
    if (!changesBetween(JSON.parse(row.payload), payload).length) throw Error('No invoice fields changed');
    const update = this.#db.prepare("UPDATE proposals SET revision=revision+1,payload=?,digest=? WHERE id=? AND revision=? AND state='REVIEW'")
      .run(JSON.stringify(payload), reviewDigest(payload, revision + 1), id, revision);
    if (update.changes !== 1) throw Error('Stale review');
    const updated = this.#row(id);
    this.#snapshot(updated, cause, sourceIds, row);
    return this.#public(updated);
  }
  revise(id, revision, changes) {
    const result = this.#transaction(() => this.#revise(id, revision, changes, [], 'manual_revision'));
    this.#epoch++;
    return result;
  }
  discard(id, revision, acknowledgeRemoteUnknown = false) {
    const row = this.#row(id);
    if (row.revision !== revision) throw new AppError('STALE_REVIEW', 'Stale review', 409);
    if (['DISCARDED','ARCHIVED_UNCERTAIN'].includes(row.state)) return this.#public(row);
    if (this.#activeCreates.has(id) || this.#recoveries.has(id) || !['REVIEW','UNCERTAIN'].includes(row.state))
      throw new AppError('STATE_CONFLICT', 'Only a local review draft or an inactive uncertain attempt can be discarded', 409);
    if (row.state === 'UNCERTAIN' && acknowledgeRemoteUnknown !== true)
      throw new AppError('REMOTE_OUTCOME_UNKNOWN', 'Archiving does not cancel a possible PayPal invoice. Acknowledge the unresolved remote outcome.', 409);
    const state = row.state === 'UNCERTAIN' ? 'ARCHIVED_UNCERTAIN' : 'DISCARDED';
    this.#transaction(() => {
      this.#db.prepare('UPDATE proposals SET state=? WHERE id=?').run(state, id);
      this.#event(row, state === 'DISCARDED' ? 'local_discarded' : 'uncertain_archived', { remote_cancelled: false });
    });
    this.#epoch++; return this.#public(this.#row(id));
  }
  // Human correction is local; changed project changes the configured recipient and invalidates old review.
  correct(id, revision, topicId) {
    const row = this.#row(id);
    if (row.state !== 'REVIEW' || Number(row.revision) !== revision) throw new Error('Stale review or immutable remote draft');
    const topic = this.#topics.find(t => t.id === topicId);
    if (!topic) throw new Error('Unknown topic');
    if (!topic.invoice_enabled) throw new Error('This topic is for notes, not customer invoices');
    const payload = JSON.parse(row.payload);
    payload.detail.reference = topic.id;
    payload.detail.memo = `TheOne Sandbox topic: ${topic.title}`;
    payload.primary_recipients[0].billing_info.email_address = topic.recipient;
    this.#transaction(() => {
      const update = this.#db.prepare("UPDATE proposals SET topic_id=?,revision=revision+1,payload=?,digest=? WHERE id=? AND revision=? AND state='REVIEW'")
        .run(topicId, JSON.stringify(payload), reviewDigest(payload, revision + 1), id, revision);
      if (update.changes !== 1) throw new Error('Stale review');
      this.#snapshot(this.#row(id), 'project_corrected', [], row);
      const linked = this.#db.prepare('SELECT * FROM proposal_messages WHERE proposal_id=?').get(id);
      if (linked && row.topic_id !== topicId) {
        const ids = [...this.#db.prepare('SELECT message_id FROM proposal_context WHERE proposal_id=? ORDER BY rowid').all(id).map(r => r.message_id), linked.user_id, linked.reply_id];
        const messages = ids.map(messageId => this.#db.prepare('SELECT * FROM desk_messages WHERE id=?').get(messageId))
          .filter(Boolean).sort((a, b) => a.n - b.n);
        const source = messages.filter(m => m.role === 'user').map(m => m.text).join('\n');
        this.#db.prepare('INSERT INTO desk_corrections (text,wrong_id,right_id) VALUES (?,?,?)').run(source, row.topic_id, topicId);
        for (const message of messages) {
          const receipt = { ...JSON.parse(message.route), topicId, correctedFrom: row.topic_id, corrected: true };
          this.#db.prepare('UPDATE desk_messages SET topic_id=?,route=? WHERE id=?').run(topicId, JSON.stringify(receipt), message.id);
        }
        const foreground = this.#setting('foreground');
        if (ids.includes(foreground?.messageId)) {
          this.#set('currentId', topicId); this.#set('foreground', { ...foreground, topicId });
        }
      }
    });
    this.#epoch++;
    return this.#public(this.#row(id));
  }
  async approve(id, digest) {
    const row = this.#row(id);
    if (digest !== row.digest) throw new Error('Review changed: inspect the current project, recipient and amount');
    if (row.state === 'CREATED') return this.#public(row);
    if (row.state !== 'REVIEW') throw new Error('Creation is pending or uncertain; do not automatically retry');
    this.#transaction(() => {
      const claimed = this.#db.prepare("UPDATE proposals SET state='CREATING' WHERE id=? AND state='REVIEW' AND digest=?")
        .run(id, digest);
      if (claimed.changes !== 1) throw new Error('Creation already claimed');
      this.#event(row, 'creation_requested', { digest, invoice_number: JSON.parse(row.payload).detail.invoice_number });
    });
    this.#activeCreates.add(id);
    try {
      const remoteId = await this.#paypal.createDraft(JSON.parse(row.payload));
      this.#transaction(() => {
        this.#db.prepare("UPDATE proposals SET remote_id=?,state='VERIFYING' WHERE id=?").run(remoteId, id);
        this.#event(row, 'remote_identified', { remote_id: remoteId });
      });
      await this.#verify(id);
      return this.#public(this.#row(id));
    } catch (error) {
      const current = this.#row(id);
      if (error instanceof PayPalError && error.outcome === 'not_created' && !current.remote_id) {
        this.#transaction(() => {
          this.#db.prepare("UPDATE proposals SET state='REVIEW',revision=revision+1,digest=?,failure=? WHERE id=?")
            .run(reviewDigest(JSON.parse(row.payload), row.revision + 1), error.message, id);
          this.#snapshot(this.#row(id), 'creation_rejected', [], row);
          this.#event(this.#row(id), 'creation_not_performed', error.details);
        });
        this.#epoch++;
        throw new AppError(error.code, 'PayPal did not create an invoice. Fix the configuration or invoice fields, then review again.', error.status,
          { ...error.details, proposal_id: id, revision: row.revision + 1, next_action: 'review_again' });
      }
      this.#transaction(() => {
        const reason = String(error.message).slice(0, 300);
        this.#db.prepare("UPDATE proposals SET state='UNCERTAIN',failure=? WHERE id=?").run(reason, id);
        this.#event(row, 'verification_pending', { reason });
      });
      throw new AppError('PAYPAL_OUTCOME_UNKNOWN', 'Sandbox creation could not be verified. No automatic retry; inspect or reconcile the existing attempt.', 502,
        { proposal_id: id, remote_outcome: 'unknown', next_action: 'reconcile' });
    } finally { this.#activeCreates.delete(id); }
  }
  async #verify(id) {
    const row = this.#row(id), local = JSON.parse(row.payload);
    const remote = await this.#paypal.getDraft(row.remote_id);
    this.#assertRemote(row.remote_id, local, remote, true);
    this.#transaction(() => {
      this.#db.prepare("UPDATE proposals SET state='CREATED',failure=NULL WHERE id=?").run(id);
      this.#event(row, 'remote_verified', { remote_id: row.remote_id, digest: row.digest,
        invoice_number: local.detail.invoice_number, status: remote.status });
    });
  }
  #assertRemote(remoteId, local, remote, draftOnly = false) {
    const expected = local.items[0].unit_amount;
    if (!remote || remote.id !== remoteId || draftOnly && remote.status !== 'DRAFT' ||
        remote.detail?.invoice_number !== local.detail.invoice_number ||
        remote.detail?.currency_code !== expected.currency_code ||
        remote.detail?.reference !== local.detail.reference ||
        remote.primary_recipients?.length !== 1 || (remote.additional_recipients?.length ?? 0) !== 0 ||
        remote.primary_recipients?.[0]?.billing_info?.email_address !== local.primary_recipients[0].billing_info.email_address ||
        remote.items?.length !== 1 || !/^1(\.0{1,5})?$/.test(remote.items[0].quantity ?? '') ||
        remote.items[0].name !== local.items[0].name ||
        remote.items[0].unit_amount?.currency_code !== expected.currency_code ||
        money(remote.items[0].unit_amount?.value) !== expected.value ||
        remote.amount?.currency_code !== expected.currency_code || money(remote.amount?.value) !== expected.value) {
      throw new AppError('REMOTE_MISMATCH', 'Remote invoice does not match the reviewed project, recipient or total', 409);
    }
  }
  #saveRemoteStatus(row, remote) {
    const snapshot = { status: remote?.status ?? 'DELETED', observed_at: new Date().toISOString(), source: 'paypal_sandbox_get',
      ...(remote ? { total: remote.amount, ...(remote.due_amount ? { due_amount: remote.due_amount } : {}) } : {}) };
    // Only expose PayPal's Sandbox customer link, never arbitrary URLs returned by an upstream.
    try {
      const url = new URL(remote?.detail?.metadata?.recipient_view_url);
      if (url.protocol === 'https:' && ['www.sandbox.paypal.com','sandbox.paypal.com'].includes(url.hostname) &&
          !url.username && !url.password && !url.port && url.pathname.startsWith('/invoice/')) snapshot.payment_link = url.href;
    } catch { /* optional link */ }
    this.#db.prepare('INSERT OR REPLACE INTO remote_status VALUES (?,?)').run(row.id, JSON.stringify(snapshot));
    return snapshot;
  }
  async refreshRemote(id) {
    const row = this.#row(id);
    if (!['CREATED','REMOTE_ACTIVE','DELETED'].includes(row.state) || this.#remoteLocks.has(id))
      throw new AppError('STATE_CONFLICT', 'Resolve the pending invoice operation before refreshing status', 409);
    this.#remoteLocks.add(id);
    try {
      const remote = await this.#paypal.getInvoice(row.remote_id);
      if (remote) this.#assertRemote(row.remote_id, JSON.parse(row.payload), remote);
      const state = !remote ? 'DELETED' : remote.status === 'DRAFT' ? 'CREATED' : 'REMOTE_ACTIVE';
      return this.#transaction(() => {
        this.#db.prepare('UPDATE proposals SET state=? WHERE id=?').run(state, id);
        const snapshot = this.#saveRemoteStatus(row, remote);
        this.#event(row, 'remote_status_refreshed', snapshot);
        return { proposal: this.#public(this.#row(id)), ...snapshot };
      });
    } finally { this.#remoteLocks.delete(id); }
  }
  reviewRemote(id, revision, action, changes) {
    const row = this.#row(id);
    if (row.revision !== revision || row.state !== 'CREATED' || this.#remoteLocks.has(id))
      throw new AppError('STATE_CONFLICT', 'Remote changes require the current verified draft revision', 409);
    if (!['update','delete','publish'].includes(action)) throw Error('Invalid remote action');
    const payload = JSON.parse(row.payload);
    if (action === 'update') {
      const patch = revisionPatch(changes), item = payload.items[0];
      if (patch.amount !== undefined) item.unit_amount.value = patch.amount;
      if (patch.currency !== undefined) item.unit_amount.currency_code = payload.detail.currency_code = patch.currency;
      if (patch.description !== undefined) item.name = patch.description;
      if (!changesBetween(JSON.parse(row.payload),payload).length) throw Error('No invoice fields changed');
    } else if (changes !== undefined) throw Error('This action does not accept changes');
    const operation = { id, revision, action, remote_id: row.remote_id, before_digest: row.digest, payload };
    return { ...operation, digest: hash(operation), fields: invoiceFields(payload),
      changes: changesBetween(JSON.parse(row.payload),payload), sends_email: false,
      effect: action === 'publish' ? 'Make this Sandbox invoice payable through a share link, without email. This does not pay it.'
        : action === 'delete' ? 'Delete this unsent draft from PayPal Sandbox.' : 'Update this unsent PayPal Sandbox draft without email.' };
  }
  async applyRemote(id, revision, action, changes, digest) {
    const old = this.#db.prepare('SELECT * FROM remote_operations WHERE proposal_id=?').get(id);
    if (old?.status === 'SUCCEEDED' && JSON.parse(old.operation).digest === digest) return this.#public(this.#row(id));
    const operation = this.reviewRemote(id, revision, action, changes);
    if (digest !== operation.digest) throw new AppError('STALE_REVIEW', 'Review changed: inspect the remote action first', 409);
    const row = this.#row(id);
    this.#transaction(() => {
      this.#db.prepare('INSERT OR REPLACE INTO remote_operations VALUES (?,?,?)').run(id, JSON.stringify(operation), 'PENDING');
      this.#db.prepare("UPDATE proposals SET state='REMOTE_PENDING' WHERE id=?").run(id);
      this.#event(row, 'remote_action_requested', { action, digest });
    });
    this.#remoteLocks.add(id); this.#epoch++;
    let mutationStarted = false, mutationAcknowledged = false;
    try {
      const remote = await this.#paypal.getInvoice(row.remote_id);
      this.#assertRemote(row.remote_id, JSON.parse(row.payload), remote, true);
      if (action === 'publish' && remote.detail.invoice_date && remote.detail.invoice_date > new Date().toISOString().slice(0,10))
        throw new AppError('FUTURE_INVOICE', 'Scheduled invoices cannot be published by this workflow', 409);
      mutationStarted = true;
      if (action === 'update') {
        // PUT is a full replacement. Preserve merchant fields read from this exact invoice.
        const detail = { ...remote.detail, ...operation.payload.detail }; delete detail.metadata;
        await this.#paypal.updateDraft(row.remote_id, { ...operation.payload, detail,
          ...(remote.invoicer ? { invoicer: remote.invoicer } : {}) });
      } else if (action === 'delete') await this.#paypal.deleteDraft(row.remote_id);
      else await this.#paypal.publishInvoice(row.remote_id);
      mutationAcknowledged = true;
      return await this.#verifyRemoteOperation(operation);
    } catch (error) {
      const definite = !mutationStarted || !mutationAcknowledged && error instanceof PayPalError && error.outcome !== 'unknown';
      this.#transaction(() => {
        this.#db.prepare('UPDATE proposals SET state=?,failure=? WHERE id=?')
          .run(definite ? 'CREATED' : 'REMOTE_UNCERTAIN', redact(error.message).slice(0,300), id);
        this.#db.prepare('UPDATE remote_operations SET status=? WHERE proposal_id=?').run(definite ? 'REJECTED' : 'UNCERTAIN', id);
        this.#event(row, definite ? 'remote_action_rejected' : 'remote_action_uncertain', { action, reason: redact(error.message).slice(0,300) });
      });
      if (definite) throw error;
      throw new AppError('REMOTE_ACTION_UNKNOWN', 'Remote action outcome is unknown. Reconcile without repeating the mutation.', 502, { next_action: 'remote_reconcile' });
    } finally { this.#remoteLocks.delete(id); }
  }
  async #verifyRemoteOperation(operation) {
    const row = this.#row(operation.id), remote = await this.#paypal.getInvoice(row.remote_id);
    if (operation.action === 'delete') {
      if (remote !== null) throw new AppError('DELETE_NOT_VERIFIED', 'Remote invoice still exists; deletion is not verified', 409);
    } else {
      this.#assertRemote(row.remote_id, operation.payload, remote, operation.action === 'update');
      if (operation.action === 'publish' && !['SENT','UNPAID','PAID','MARKED_AS_PAID','PARTIALLY_PAID','PAYMENT_PENDING'].includes(remote.status))
        throw new AppError('PUBLISH_NOT_VERIFIED', 'Remote invoice is not confirmed payable', 409);
    }
    return this.#transaction(() => {
      const state = operation.action === 'delete' ? 'DELETED' : operation.action === 'update' ? 'CREATED' : 'REMOTE_ACTIVE';
      const revision = row.revision + 1;
      this.#db.prepare('UPDATE proposals SET state=?,payload=?,revision=?,digest=?,failure=NULL WHERE id=?')
        .run(state, JSON.stringify(operation.payload), revision, reviewDigest(operation.payload,revision), row.id);
      this.#snapshot(this.#row(row.id), `remote_${operation.action}_verified`, [], row);
      this.#saveRemoteStatus(row,remote);
      this.#db.prepare("UPDATE remote_operations SET status='SUCCEEDED' WHERE proposal_id=?").run(row.id);
      this.#epoch++;
      return this.#public(this.#row(row.id));
    });
  }
  async reconcileRemote(id) {
    if (this.#remoteLocks.has(id)) throw new AppError('STATE_CONFLICT', 'Remote action is still in progress', 409);
    const stored = this.#db.prepare('SELECT * FROM remote_operations WHERE proposal_id=?').get(id);
    if (!stored) throw new AppError('NO_REMOTE_OPERATION', 'No remote operation to reconcile', 409);
    if (stored.status === 'SUCCEEDED') return this.#public(this.#row(id));
    if (!['PENDING','UNCERTAIN'].includes(stored.status)) throw new AppError('STATE_CONFLICT', 'This operation was rejected; review it again', 409);
    this.#remoteLocks.add(id);
    try { return await this.#verifyRemoteOperation(JSON.parse(stored.operation)); }
    finally { this.#remoteLocks.delete(id); }
  }
  reconcile(id) {
    if (this.#recoveries.has(id)) return this.#recoveries.get(id);
    const run = this.#reconcile(id).finally(() => this.#recoveries.delete(id));
    this.#recoveries.set(id, run);
    return run;
  }
  async #reconcile(id) {
    const row = this.#row(id);
    if (row.state === 'CREATED') return this.#public(row);
    if (this.#activeCreates.has(id)) throw Error('Creation is still in progress');
    if (!['CREATING', 'VERIFYING', 'UNCERTAIN', 'ARCHIVED_UNCERTAIN'].includes(row.state)) throw Error('No creation attempt to reconcile');
    this.#event(row, 'reconciliation_requested', { has_remote_id: Boolean(row.remote_id) });
    try {
      if (!row.remote_id) {
        if (typeof this.#paypal.findDraftByInvoiceNumber !== 'function') throw Error('No known remote ID: check Sandbox dashboard manually; never retry creation');
        const invoiceNumber = JSON.parse(row.payload).detail.invoice_number;
        const remoteId = await this.#paypal.findDraftByInvoiceNumber(invoiceNumber);
        if (!remoteId) throw Error('No matching invoice found yet. The outcome remains uncertain; do not create another invoice');
        if (!/^INV2-[A-Z0-9-]+$/.test(remoteId)) throw Error('Invalid recovered invoice ID');
        this.#transaction(() => {
          this.#db.prepare("UPDATE proposals SET remote_id=?,state='VERIFYING' WHERE id=?").run(remoteId, id);
          this.#event(row, 'remote_recovered', { remote_id: remoteId, invoice_number: invoiceNumber });
        });
      }
      await this.#verify(id);
      return this.#public(this.#row(id));
    } catch (error) {
      this.#transaction(() => {
        const reason = String(error.message).slice(0, 300);
        this.#db.prepare('UPDATE proposals SET state=?,failure=? WHERE id=?').run(row.state === 'ARCHIVED_UNCERTAIN' ? row.state : 'UNCERTAIN', reason, id);
        this.#event(row, 'reconciliation_unresolved', { reason });
      });
      throw error;
    }
  }
}
