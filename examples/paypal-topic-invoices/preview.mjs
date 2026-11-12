// Explicit offline scenarios for UI review. These are scripted responses, NOT model evidence.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.mjs';
import { InvoiceWorkflow } from './workflow.mjs';

export const previewTopics = [
  { id: 'design', title: 'Design client', aliases: ['设计客户', '设计项目'], summary: 'Website design, visual assets and design service invoices.', recipient: 'design-buyer@example.invalid' },
  { id: 'move', title: 'Moving project', aliases: ['搬家项目'], summary: 'Moving logistics, relocation services and project invoices.', recipient: 'move-buyer@example.invalid' },
  { id: 'budget', title: 'Household budget', summary: 'Personal expenses and monthly budgeting; no client invoices.', recipient: 'budget@example.invalid', invoice_enabled: false },
];
const model = 'scripted/offline-preview';
const blank = (intent, topic_id, reply) => ({ intent, topic_id, amount: null, currency: null, description: null, reply });
export const previewPlanner = {
  async route(message, topics, context) {
    let id, reason, action = 'EXISTING', relatedIds = [];
    const correction = context.corrections?.findLast(c => c.text === message);
    if (correction) { id = correction.rightId; reason = 'Uses the project you previously corrected for this message.'; }
    else if (/预算|budget/i.test(message)) { id = 'budget'; reason = 'Personal expenses belong to the household budget.'; if (/参考.*设计|refer.*design/i.test(message)) relatedIds = ['design']; }
    else if (/设计|design/i.test(message)) { id = 'design'; reason = context.currentId === id ? 'Continues the design context.' : 'Explicitly refers to the design client.'; }
    else if (/搬家|mov(?:e|ing)/i.test(message)) { id = 'move'; reason = 'This message concerns the moving project.'; }
    else if (/日本|旅行|japan|travel/i.test(message)) {
      const existing = topics.find(t => ['Japan trip', '日本旅行'].includes(t.title));
      if (existing) { id = existing.id; reason = 'Continues the existing trip notes.'; }
      else return { decision: { action: 'CREATE', contextId: null, title: 'Japan trip', reason: 'A new independent topic for notes only.', historyIndependent: true, relatedIds: [] }, model };
    } else if (!/之前那个客户|上次那个|which client|previous client|that client|last client/i.test(message) && context.currentId) {
      id = context.currentId; reason = 'Continues the current work using recent context.';
    } else return { decision: { action: 'CLARIFY', contextId: null, candidateIds: ['design', 'move'], relatedIds: [],
      question: 'Do you mean the design client or the moving project?', reason: 'More information is needed to distinguish the projects.' }, model };
    const resolvesQuestion = !!context.pendingQuestion && /^(?:设计(?:客户|项目)?|搬家(?:项目)?|(?:the )?design(?: client| project)?|(?:the )?moving(?: project)?)[。.!！]?$/i.test(message.trim());
    return { decision: { action, contextId: id, reason, relatedIds, resolvesQuestion }, model };
  },
  async plan(message, topics, context) {
    const topic = topics[0];
    if (/status|how much|how many|awaiting review|which.*drafts|状态|多少.*(?:发票|待核对)/i.test(message)) {
      return { model, plan: blank('invoice_status', topic.id, 'Reading the local invoice records.') };
    }
    if (topic.invoice_enabled === false || /不要.*发票|不.*开票|no invoice|(?:don't|do not).*invoice/i.test(message)) return { model, plan: blank('chat', topic.id, `Saved to ${topic.title}. No invoice created.`) };
    if (/change|update|revise|make it|rename|改成|改为|调整|修改/i.test(message)) {
      const drafts = context.drafts ?? [];
      const target = drafts.find(p => p.id === context.selectedDraftId) ?? drafts.find(p => message.includes(p.invoice_number)) ?? (drafts.length === 1 && !context.draftsOverflow ? drafts[0] : null);
      if (!target) return { model, plan: blank('clarify', null, drafts.length
        ? 'Include the invoice number and repeat the change: ' + drafts.map(p => `${p.invoice_number} (${p.amount} ${p.currency})`).join('; ')
        : 'There is no editable draft in this project. Please request a new invoice.') };
      const amount = [...message.matchAll(/(\d+(?:\.\d{1,2})?)\s*(EUR|USD|GBP)/ig)].at(-1);
      const description = /(?:rename|description(?: to)?)\s+["“]([^"”]+)["”]/i.exec(message)?.[1] ?? null;
      if (!amount && !description) return { model, plan: blank('clarify', null, 'Specify a new amount and currency, or rename the service in quotes.') };
      return { model, plan: { intent: 'invoice_update', topic_id: topic.id, proposal_id: target.id, revision: target.revision,
        amount: amount?.[1] ?? null, currency: amount?.[2].toUpperCase() ?? null, description,
        reply: 'Updated the existing draft. Please review the changes before creating it.' } };
    }
    const recentUsers = context.recent?.filter(m => m.role === 'user') ?? [];
    const prior = recentUsers.at(-1)?.text ?? '';
    const explicit = /发票|invoice/i.test(message);
    const answering = /金额|素材|服务|设计|搬家|amount|assets|service|design|moving|\d/i.test(message) && /补充|你指的是|Please add|Do you mean/.test(context.recent?.at(-1)?.text ?? '');
    if (!explicit && !answering) return { model, plan: blank('chat', topic.id, `Back to ${topic.title}. Your drafts are saved.`) };
    const combined = message + (answering ? ' ' + prior : '');
    const match = /(\d+(?:\.\d{1,2})?)\s*(EUR|USD|GBP)/i.exec(combined);
    if (!match) return { model, plan: blank('clarify', null, 'Please add the amount, currency (for example, 480 EUR) and service description.') };
    return { model, plan: { intent: 'invoice_draft', topic_id: topic.id, amount: match[1], currency: match[2].toUpperCase(),
      description: /网站|素材|website|assets/i.test(combined) ? 'Website design assets' : 'Project services', reply: 'Your draft is ready. Review the recipient and amount before creating it.' } };
  },
};
export function previewPayPal() {
  const drafts = new Map();
  const statuses = new Map(); let sequence = 0;
  return { async createDraft(payload) { const id = `INV2-PREVIEW-${Date.now()}-${++sequence}`; drafts.set(id, structuredClone(payload)); statuses.set(id,'DRAFT'); return id; },
    async getDraft(id) { const payload = drafts.get(id); if (!payload) throw Error('Preview draft belongs to an earlier process');
      return { ...payload, id, status: statuses.get(id), amount: structuredClone(payload.items[0].unit_amount) }; },
    async getInvoice(id) { return drafts.has(id) ? this.getDraft(id) : null; },
    async updateDraft(id,payload) { drafts.set(id,structuredClone(payload)); },
    async deleteDraft(id) { drafts.delete(id); statuses.delete(id); },
    async publishInvoice(id) { statuses.set(id,'SENT'); },
    async findDraftByInvoiceNumber(number) {
      return [...drafts].find(([, p]) => p.detail.invoice_number === number)?.[0] ?? null;
    } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The merged web demo uses its own file; earlier frontend and backend preview records are retained.
  const database = process.env.THEONE_PREVIEW_DATABASE || '.data/preview-invoice-desk.sqlite';
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  const paypal = previewPayPal();
  const seed = new InvoiceWorkflow({ database, topics: previewTopics, planner: previewPlanner, paypal });
  if (!seed.messages().length) {
    await seed.plan('Draft a 480 EUR invoice for the design client for website assets.');
  }
  seed.close();
  const app = createApp({ database, topics: previewTopics, planner: previewPlanner, paypal, preview: true });
  const port = Number(process.env.PORT || 3071);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid preview port');
  app.listen(port, '127.0.0.1', () => console.log(`Offline scripted preview: http://127.0.0.1:${port} — no model or PayPal API calls`));
}
