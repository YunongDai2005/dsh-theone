import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

const currencies = new Set(['USD', 'EUR', 'GBP']);
export function money(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})(\.\d{1,2})?$/.test(value)) throw new Error('Amount must be an exact decimal string');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1 || cents > 1_000_000) throw new Error('Sandbox amount must be between 0.01 and 10000.00');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  if (!plan || Array.isArray(plan) || typeof plan !== 'object' ||
      JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(keys)) throw new Error('Unexpected model plan schema');
  if (typeof plan.reply !== 'string' || plan.reply.length > 1000) throw new Error('Invalid model reply');
  if (!['chat', 'invoice_draft', 'clarify'].includes(plan.intent)) throw new Error('Unknown model intent');
  if (plan.intent === 'clarify') {
    if (plan.topic_id !== null) throw new Error('Clarification cannot select a topic');
  } else if (!topics.some(t => t.id === plan.topic_id)) throw new Error('Unknown model topic');
  if (plan.intent === 'invoice_draft') {
    if (!currencies.has(plan.currency)) throw new Error('Unsupported invoice currency');
    return { ...plan, amount: money(plan.amount), description: text(plan.description, 200, 'invoice description') };
  }
  text(plan.reply, 1000, 'model reply');
  if ([plan.amount, plan.currency, plan.description].some(v => v !== null)) throw new Error('Non-invoice plan cannot contain invoice fields');
  return plan;
}

export class InvoiceWorkflow {
  #db; #topics; #planner; #paypal;
  constructor({ database = ':memory:', topics, planner, paypal }) {
    if (!Array.isArray(topics) || !topics.length || topics.length > 16) throw new Error('Configure 1–16 topics');
    const ids = new Set();
    this.#topics = topics.map(t => {
      if (!/^[a-z0-9_-]{1,40}$/.test(t.id) || ids.has(t.id)) throw new Error('Invalid or duplicate topic ID');
      ids.add(t.id);
      return { id: t.id, title: text(t.title, 100, 'topic title'), summary: text(t.summary, 500, 'topic summary'),
        recipient: email(t.recipient), invoice_enabled: t.invoice_enabled !== false };
    });
    this.#planner = planner; this.#paypal = paypal;
    this.#db = new DatabaseSync(database);
    this.#db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS proposals(
      id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, revision INTEGER NOT NULL,
      state TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
      model TEXT NOT NULL, remote_id TEXT, failure TEXT, created_at TEXT NOT NULL
    )`);
  }
  close() { this.#db.close(); }
  topics() { return this.#topics.map(({ recipient, ...t }) => t); }
  proposals(topicId) {
    if (topicId !== undefined && !this.#topics.some(t => t.id === topicId)) throw new Error('Unknown topic');
    const rows = topicId === undefined ? this.#db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all()
      : this.#db.prepare('SELECT * FROM proposals WHERE topic_id=? ORDER BY created_at DESC').all(topicId);
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
  async plan(message) {
    text(message, 4000, 'message');
    const result = await this.#planner.plan(message, this.topics());
    const plan = validatePlan(result.plan, this.#topics);
    if (plan.intent !== 'invoice_draft') return { ...result, plan, proposal: null };
    const id = randomUUID(), payload = this.#payload(id, plan), digest = hash(payload);
    this.#db.prepare('INSERT INTO proposals VALUES (?,?,1,?,?,?,?,NULL,NULL,?)')
      .run(id, plan.topic_id, 'REVIEW', JSON.stringify(payload), digest, text(result.model, 200, 'model'), new Date().toISOString());
    return { ...result, plan, proposal: this.#public(this.#row(id)) };
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
    const update = this.#db.prepare('UPDATE proposals SET topic_id=?,revision=revision+1,payload=?,digest=? WHERE id=? AND revision=? AND state=\'REVIEW\'')
      .run(topicId, JSON.stringify(payload), hash(payload), id, revision);
    if (update.changes !== 1) throw new Error('Stale review');
    return this.#public(this.#row(id));
  }
  async approve(id, digest) {
    const row = this.#row(id);
    if (digest !== row.digest) throw new Error('Review changed: inspect the current project, recipient and amount');
    if (row.state === 'CREATED') return this.#public(row);
    if (row.state !== 'REVIEW') throw new Error('Creation is pending or uncertain; do not automatically retry');
    const claimed = this.#db.prepare("UPDATE proposals SET state='CREATING' WHERE id=? AND state='REVIEW' AND digest=?")
      .run(id, digest);
    if (claimed.changes !== 1) throw new Error('Creation already claimed');
    try {
      const remoteId = await this.#paypal.createDraft(JSON.parse(row.payload));
      this.#db.prepare("UPDATE proposals SET remote_id=?,state='VERIFYING' WHERE id=?").run(remoteId, id);
      await this.#verify(id);
      return this.#public(this.#row(id));
    } catch (error) {
      this.#db.prepare("UPDATE proposals SET state='UNCERTAIN',failure=? WHERE id=?").run(String(error.message).slice(0, 300), id);
      throw new Error('Sandbox creation could not be verified. No automatic retry; inspect or reconcile the existing attempt.');
    }
  }
  async #verify(id) {
    const row = this.#row(id), local = JSON.parse(row.payload);
    const remote = await this.#paypal.getDraft(row.remote_id);
    const expected = local.items[0].unit_amount;
    if (remote.detail?.invoice_number !== local.detail.invoice_number ||
        remote.detail?.reference !== local.detail.reference ||
        remote.primary_recipients?.[0]?.billing_info?.email_address !== local.primary_recipients[0].billing_info.email_address ||
        remote.items?.length !== 1 || !/^1(\.0{1,5})?$/.test(remote.items[0].quantity ?? '') ||
        remote.items[0].name !== local.items[0].name ||
        remote.items[0].unit_amount?.currency_code !== expected.currency_code ||
        money(remote.items[0].unit_amount?.value) !== expected.value ||
        remote.amount?.currency_code !== expected.currency_code || money(remote.amount?.value) !== expected.value) {
      throw new Error('Remote invoice does not match the reviewed project, recipient or total');
    }
    this.#db.prepare("UPDATE proposals SET state='CREATED',failure=NULL WHERE id=?").run(id);
  }
  async reconcile(id) {
    const row = this.#row(id);
    if (row.state === 'CREATED') return this.#public(row);
    if (!row.remote_id || !['VERIFYING', 'UNCERTAIN'].includes(row.state)) throw new Error('No known remote ID: check Sandbox dashboard manually; never retry creation');
    await this.#verify(id);
    return this.#public(this.#row(id));
  }
}
