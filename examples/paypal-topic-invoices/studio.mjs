import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { InvoiceWorkflow } from './workflow.mjs';
import { AppError } from './errors.mjs';
import { selectDraft } from './invoice-selection.mjs';

const finance = actor => ['admin', 'finance'].includes(actor.role);
const denied = () => new AppError('FORBIDDEN', 'Your studio role does not permit this action.', 403);
const missing = () => new AppError('NOT_FOUND', 'This bill or project is not available in your workspace.', 404);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cleanMember = member => ({ id: member.id, name: member.name, role: member.role, project_ids: [...member.project_ids] });

export function validateMembers(members, topics) {
  if (!Array.isArray(members) || !members.length || members.length > 50) throw Error('Configure 1–50 studio members');
  const ids = new Set(), names = new Set(), projectIds = new Set(topics.map(t => t.id));
  return members.map(member => {
    if (!/^[a-z0-9_-]{1,40}$/.test(member.id) || ids.has(member.id)) throw Error('Invalid or duplicate studio member ID');
    if (typeof member.name !== 'string' || !member.name.trim() || member.name.length > 80 || /[\u0000-\u001f]/.test(member.name)) throw Error('Invalid studio member name');
    const name = member.name.trim(), lookup = name.toLocaleLowerCase('en-US');
    if (names.has(lookup)) throw Error('Studio login names must be unique');
    if (!['admin', 'finance', 'member'].includes(member.role)) throw Error('Invalid studio role');
    if (!Array.isArray(member.project_ids) || !member.project_ids.length || new Set(member.project_ids).size !== member.project_ids.length ||
        member.project_ids.some(id => !projectIds.has(id))) throw Error('Invalid studio project membership');
    ids.add(member.id); names.add(lookup);
    return { ...member, name, project_ids: [...member.project_ids] };
  });
}

// Every member owns an independent routing conversation. Project sharing is an
// authorization-filtered projection; it never inserts a teammate's chat into a model prompt.
export class StudioWorkflow {
  #members; #entries = new Map(); #topics; #audit; #studio;
  constructor({ members, topics, planner, paypal, databaseDirectory = ':memory:', studio = { id: 'theone-studio', name: 'The One Studio' } }) {
    if (!studio || !/^[a-z0-9_-]{1,60}$/.test(studio.id) || typeof studio.name !== 'string' || !studio.name.trim() || studio.name.length > 100) throw Error('Invalid studio identity');
    this.#studio = { id: studio.id, name: studio.name.trim() };
    this.#topics = structuredClone(topics);
    this.#members = validateMembers(members, topics);
    const memory = databaseDirectory === ':memory:';
    if (!memory) { mkdirSync(databaseDirectory, { recursive: true, mode: 0o700 }); chmodSync(databaseDirectory, 0o700); }
    const auditPath = memory ? ':memory:' : join(databaseDirectory, 'studio.sqlite');
    this.#audit = new DatabaseSync(auditPath);
    this.#audit.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS studio_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_events (n INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL, actor_id TEXT NOT NULL, owner_id TEXT NOT NULL, action TEXT NOT NULL,
        revision INTEGER NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL);`);
    // Silently reusing databases under a different membership policy could expose
    // historical routing context. Membership changes require a deliberate migration.
    const acl = hash({ studio: studio.id, members: this.#members.map(m => ({ id: m.id, projects: [...m.project_ids].sort() })).sort((a,b) => a.id.localeCompare(b.id)), topics: topics.map(t => t.id).sort() });
    const stored = this.#audit.prepare("SELECT value FROM studio_metadata WHERE key='acl'").get();
    if (stored && stored.value !== acl) { this.#audit.close(); throw Error('Studio memberships changed. Use a new data directory or explicitly migrate the existing studio before starting.'); }
    this.#audit.prepare("INSERT OR IGNORE INTO studio_metadata VALUES ('acl', ?)").run(acl);
    try {
      for (const member of this.#members) {
        const path = memory ? ':memory:' : join(databaseDirectory, `member-${member.id}.sqlite`);
        const provider = typeof planner === 'function' ? planner(cleanMember(member)) : planner;
        const memberPlanner = {
          route: provider.route.bind(provider),
          plan: async (message,catalog,context) => {
            // Group-visible answers cannot draw from another project's private
            // history, even when the author personally belongs to both projects.
            const result = await provider.plan(message,catalog,{ ...context, references: [] });
            if (result.plan?.intent !== 'invoice_status') return result;
            // Keep the authoritative team reply in the original message store.
            // The underlying single-owner workflow replaces invoice_status with
            // its personal totals, so persist this already-resolved answer as chat.
            const reply = this.brief(member.id,context.topicId).text;
            return { ...result, studio_intent: 'invoice_status', plan: { ...result.plan, intent: 'chat', reply } };
          },
        };
        const workflow = new InvoiceWorkflow({ database: path, topics: topics.filter(t => member.project_ids.includes(t.id)), planner: memberPlanner, paypal });
        this.#entries.set(member.id, { member, workflow });
        if (!memory) chmodSync(path, 0o600);
      }
      if (!memory) chmodSync(auditPath, 0o600);
    } catch (error) { this.close(); throw error; }
  }
  #actor(actorId) {
    const entry = this.#entries.get(actorId);
    if (!entry) throw new AppError('AUTH_REQUIRED', 'Sign in to your studio.', 401);
    return entry;
  }
  #visible(actor, owner, topicId) {
    // Model-created notes are personal. Only explicitly configured project
    // memberships create a group; a generated title never grants access.
    return actor.id === owner.id && this.#entries.get(owner.id).workflow.topics().some(t => t.id === topicId)
      || actor.project_ids.includes(topicId) && owner.project_ids.includes(topicId);
  }
  #find(actorId, id) {
    const actor = this.#actor(actorId).member;
    if (typeof id !== 'string') throw missing();
    for (const { member: owner, workflow } of this.#entries.values()) {
      const proposal = workflow.proposals().find(p => p.id === id);
      if (proposal && this.#visible(actor, owner, proposal.topic_id)) return { actor, owner, workflow, proposal };
    }
    throw missing();
  }
  #permissions(actor, owner, proposal) {
    const edit = actor.id === owner.id || finance(actor);
    return {
      edit: edit && proposal.state === 'REVIEW', correct: edit && proposal.state === 'REVIEW',
      discard: edit && ['REVIEW', 'UNCERTAIN'].includes(proposal.state),
      approve: finance(actor) && proposal.state === 'REVIEW',
      reconcile: finance(actor) && ['CREATING', 'VERIFYING', 'UNCERTAIN', 'ARCHIVED_UNCERTAIN'].includes(proposal.state),
      remote: finance(actor) && ['CREATED', 'REMOTE_ACTIVE', 'REMOTE_PENDING', 'REMOTE_UNCERTAIN'].includes(proposal.state),
    };
  }
  #proposal(actor, owner, proposal) {
    return { ...proposal, owner_id: owner.id, owner_name: owner.name, permissions: this.#permissions(actor, owner, proposal) };
  }
  #messageVisible(actor,owner,message) {
    if (actor.id === owner.id) return true;
    const route = message.route ?? {};
    if ((route.relatedIds ?? []).some(id => !actor.project_ids.includes(id))) return false;
    if (route.corrected && [route.correctedFrom,route.contextId].filter(Boolean).some(id => !actor.project_ids.includes(id))) return false;
    // A resolved private clarification may later be attached to a shared bill.
    // Its question text itself can name projects outside the reader's catalog.
    if (route.action === 'CLARIFY' && (route.candidateIds ?? []).some(id => !actor.project_ids.includes(id))) return false;
    return true;
  }
  #editable(found) { if (found.actor.id !== found.owner.id && !finance(found.actor)) throw denied(); }
  #financial(found) { if (!finance(found.actor)) throw denied(); }
  #record(found, action, outcome = 'succeeded', proposal = found.proposal) {
    this.#audit.prepare('INSERT INTO studio_events(proposal_id,actor_id,owner_id,action,revision,outcome,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(proposal.id, found.actor.id, found.owner.id, action, proposal.revision, outcome, new Date().toISOString());
  }
  #events(ids, limit = 100) {
    if (!ids.size) return [];
    return this.#audit.prepare('SELECT * FROM studio_events ORDER BY n DESC').all().filter(event => ids.has(event.proposal_id)).slice(0, limit).reverse()
      .map(event => ({ ...event, actor_name: this.#entries.get(event.actor_id)?.member.name ?? event.actor_id,
        owner_name: this.#entries.get(event.owner_id)?.member.name ?? event.owner_id }));
  }
  #sync(actorId, id, action, operation, financial = false) {
    const found = this.#find(actorId, id);
    financial ? this.#financial(found) : this.#editable(found);
    const result = operation(found.workflow);
    if (result?.id && result?.payload) this.#record(found, action, 'succeeded', result);
    return result?.id && result?.payload ? this.#proposal(found.actor, found.owner, result) : result;
  }
  async #async(actorId, id, action, operation) {
    const found = this.#find(actorId, id); this.#financial(found);
    this.#record(found, action, 'requested');
    try {
      const result = await operation(found.workflow);
      const current = found.workflow.proposals().find(p => p.id === id) ?? found.proposal;
      this.#record(found, action, 'succeeded', current);
      return result?.id && result?.payload ? this.#proposal(found.actor, found.owner, result) : result;
    } catch (error) {
      const current = found.workflow.proposals().find(p => p.id === id) ?? found.proposal;
      this.#record(found, action, 'failed', current); throw error;
    }
  }
  actor(actorId) { return cleanMember(this.#actor(actorId).member); }
  get studio() { return { ...this.#studio }; }
  state(actorId, { preview = false, capabilities = { model: true, paypal: true } } = {}) {
    const { member: actor, workflow: own } = this.#actor(actorId);
    const proposals = [], messages = [], visibleRevisions = new Map();
    for (const { member: owner, workflow } of this.#entries.values()) {
      for (const proposal of workflow.proposals()) if (this.#visible(actor, owner, proposal.topic_id)) {
        proposals.push(this.#proposal(actor, owner, proposal));
        visibleRevisions.set(proposal.id,new Set(workflow.history(proposal.id).versions.filter(v => this.#visible(actor,owner,v.fields.project)).map(v => v.revision)));
      }
      for (const message of workflow.messages(undefined, 200)) if (message.topic_id === null ? actor.id === owner.id : this.#visible(actor, owner, message.topic_id)) {
        // A teammate's routing trace includes their full authorized catalog and
        // personal attention state. Group readers receive only the shared target.
        // A reply that deliberately used a private project as reference is not
        // projected into a reader's narrower project view.
        if (!this.#messageVisible(actor,owner,message)) continue;
        const route = actor.id === owner.id ? message.route : message.route ? {
          action: 'EXISTING', contextId: message.topic_id, topicId: message.topic_id,
          reason: 'Shared project update. Personal routing context stays private.', shared: true,
          version: message.route.version,
        } : null;
        messages.push({ ...message, route, owner_id: owner.id, owner_name: owner.name });
      }
    }
    proposals.sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    messages.sort((a,b) => a.created_at.localeCompare(b.created_at) || a.owner_id.localeCompare(b.owner_id) || a.n - b.n);
    return { studio: this.studio, actor: cleanMember(actor),
      members: this.#members.filter(m => m.id === actor.id || m.project_ids.some(id => actor.project_ids.includes(id)))
        .map(m => ({ ...cleanMember(m), project_ids: m.project_ids.filter(id => actor.project_ids.includes(id)) })),
      topics: own.topics(), proposals, messages: messages.slice(-200), routing: own.routingState(), capabilities, preview,
      studio_events: this.#events(new Set(proposals.map(p => p.id))).filter(event => visibleRevisions.get(event.proposal_id)?.has(event.revision)),
      mode: preview ? 'Studio preview — simulated providers' : 'Studio · PayPal Sandbox drafts only' };
  }
  async plan(actorId, message, requestId) {
    const { member: actor, workflow } = this.#actor(actorId);
    if (typeof message !== 'string') throw new AppError('INVALID_REQUEST', 'A message is required.', 400);
    const normalized = message.toLocaleLowerCase('en-US');
    for (const topic of this.#topics) if (!actor.project_ids.includes(topic.id) && [topic.title, ...(topic.aliases ?? [])]
      .some(name => normalized.includes(name.toLocaleLowerCase('en-US')))) throw denied();
    const ownDrafts = workflow.proposals();
    const mentionedNumbers = message.match(/\bTO-[a-f0-9]{20}\b/ig) ?? [];
    if (mentionedNumbers.some(number => !ownDrafts.some(p => p.payload.detail.invoice_number.toLowerCase() === number.toLowerCase())))
      throw new AppError('SHARED_BILL_REVIEW_REQUIRED', 'Chat edits only your own bills. Select a shared bill for a finance reviewer to edit or approve it.', 403);
    if (/\b(?:change|update|revise|rename|edit|make)\b|修改|改成|改为|调整/i.test(message)) {
      const shared = this.state(actorId).proposals.filter(p => p.state === 'REVIEW');
      const selected = selectDraft(message, shared);
      if (selected && shared.find(p => p.id === selected)?.owner_id !== actor.id)
        throw new AppError('SHARED_BILL_REVIEW_REQUIRED', 'Chat edits only your own bills. Select a shared bill for a finance reviewer to edit or approve it.', 403);
    }
    const result = await workflow.plan(message, requestId);
    if (result.proposal) {
      const proposal = result.proposal;
      if (!result.replayed) this.#record({ actor, owner: actor, proposal }, result.plan.intent === 'invoice_update' ? 'revise_from_chat' : 'propose', 'succeeded', proposal);
      return { ...result, proposal: this.#proposal(actor, actor, proposal) };
    }
    return result.studio_intent === 'invoice_status' ? { ...result, plan: { ...result.plan, intent: 'invoice_status' } } : result;
  }
  review(actorId, id) {
    const found = this.#find(actorId, id), review = found.workflow.review(id);
    const permissions = this.#permissions(found.actor, found.owner, found.proposal);
    const previous = found.workflow.history(id).versions.at(-2);
    if (previous && !this.#visible(found.actor,found.owner,previous.fields.project)) review.changes = [];
    return { ...review, can_create: review.can_create && permissions.approve, can_discard: review.can_discard && permissions.discard,
      can_reconcile: review.can_reconcile && permissions.reconcile, owner_id: found.owner.id, owner_name: found.owner.name, permissions };
  }
  history(actorId, id) {
    const found = this.#find(actorId, id), history = found.workflow.history(id);
    const revisions = new Set(history.versions.filter(v => this.#visible(found.actor,found.owner,v.fields.project)).map(v => v.revision));
    const visibleMessages = new Set(found.workflow.messages(undefined,200).filter(message =>
      (message.topic_id === null ? found.actor.id === found.owner.id : this.#visible(found.actor,found.owner,message.topic_id)) &&
      this.#messageVisible(found.actor,found.owner,message)).map(message => message.id));
    const sourceIds = ids => (ids ?? []).filter(sourceId => visibleMessages.has(sourceId));
    const versions = history.versions.filter(v => revisions.has(v.revision)).map(v => ({ ...v, source_message_ids: sourceIds(v.source_message_ids) }));
    const events = history.events.filter(event => revisions.has(event.revision)).map(event => {
      const details = { ...event.details };
      if (details.changes && event.revision > 1 && !revisions.has(event.revision-1)) details.changes = [];
      if (details.source_message_ids) details.source_message_ids = sourceIds(details.source_message_ids);
      if (details.source_message_id && !visibleMessages.has(details.source_message_id)) delete details.source_message_id;
      return { ...event, details };
    });
    return { ...history, versions, events, proposal: this.#proposal(found.actor, found.owner, history.proposal),
      studio_events: this.#events(new Set([id]),200).filter(event => revisions.has(event.revision)) };
  }
  brief(actorId, topicId) {
    const { member: actor, workflow: own } = this.#actor(actorId);
    const topic = own.topics().find(t => t.id === topicId); if (!topic) throw missing();
    const proposals = this.state(actorId).proposals.filter(p => p.topic_id === topicId);
    const categories = { awaiting_review: ['REVIEW'], verified_drafts: ['CREATED'], needs_verification: ['CREATING','VERIFYING','UNCERTAIN','REMOTE_PENDING','REMOTE_UNCERTAIN'] };
    const groups = {};
    for (const [key, states] of Object.entries(categories)) {
      const rows = proposals.filter(p => states.includes(p.state)), totals = new Map();
      for (const p of rows) { const amount = p.payload.items[0].unit_amount; totals.set(amount.currency_code, (totals.get(amount.currency_code) ?? 0n) + BigInt(amount.value.replace('.', ''))); }
      groups[key] = { count: rows.length, totals: [...totals].sort(([a],[b]) => a.localeCompare(b)).map(([currency,cents]) => ({ currency, amount: `${cents/100n}.${String(cents%100n).padStart(2,'0')}` })) };
    }
    const lines = Object.entries(groups).map(([key,g]) => `${({awaiting_review:'Awaiting review',verified_drafts:'Verified unsent drafts',needs_verification:'Needs verification'})[key]}: ${g.count}${g.count ? ' (' + g.totals.map(t => `${t.amount} ${t.currency}`).join(', ') + ')' : ''}.`);
    return { topic_id: topicId, title: topic.title, invoice_enabled: topic.invoice_enabled, ...groups,
      discarded_count: proposals.filter(p => p.state === 'DISCARDED').length, archived_uncertain_count: proposals.filter(p => p.state === 'ARCHIVED_UNCERTAIN').length,
      deleted_count: proposals.filter(p => p.state === 'DELETED').length, source: 'authorized_studio_invoice_records', as_of: new Date().toISOString(),
      remote_statuses: [...this.#entries.values()].filter(({member}) => this.#visible(actor,member,topicId)).flatMap(({workflow}) => workflow.topics().some(t => t.id === topicId) ? workflow.brief(topicId).remote_statuses : []),
      note: 'Shared project totals use stored verified records, not a live balance or proof of payment.',
      text: `${topic.title}\n${topic.invoice_enabled ? lines.join('\n') : 'Notes only. No customer invoices.'}\nShared project records. No invoice emails are sent by this app.` };
  }
  routingMetrics(actorId) { return this.#actor(actorId).workflow.routingMetrics(); }
  attempts(actorId) { return this.#actor(actorId).workflow.attempts(); }
  correct(actorId, id, revision, topicId) {
    const found = this.#find(actorId, id); this.#editable(found);
    if (!found.actor.project_ids.includes(topicId) || !found.owner.project_ids.includes(topicId)) throw missing();
    return this.#sync(actorId,id,'correct', workflow => workflow.correct(id,revision,topicId));
  }
  revise(actorId,id,revision,changes) { return this.#sync(actorId,id,'revise',workflow => workflow.revise(id,revision,changes)); }
  discard(actorId,id,revision,acknowledge) { return this.#sync(actorId,id,'discard',workflow => workflow.discard(id,revision,acknowledge)); }
  approve(actorId,id,digest) { return this.#async(actorId,id,'approve',workflow => workflow.approve(id,digest)); }
  reconcile(actorId,id) { return this.#async(actorId,id,'reconcile',workflow => workflow.reconcile(id)); }
  reviewRemote(actorId,id,revision,action,changes) {
    const found = this.#find(actorId,id); this.#financial(found);
    return found.workflow.reviewRemote(id,revision,action,changes);
  }
  applyRemote(actorId,id,revision,action,changes,digest) { return this.#async(actorId,id,`remote_${action}`,workflow => workflow.applyRemote(id,revision,action,changes,digest)); }
  reconcileRemote(actorId,id) { return this.#async(actorId,id,'remote_reconcile',workflow => workflow.reconcileRemote(id)); }
  refreshRemote(actorId,id) { return this.#async(actorId,id,'remote_status',workflow => workflow.refreshRemote(id)); }
  close() { for (const { workflow } of this.#entries.values()) workflow.close(); this.#entries.clear(); this.#audit.close(); }
}
