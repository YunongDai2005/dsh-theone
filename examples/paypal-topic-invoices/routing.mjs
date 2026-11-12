import { ROUTING_PROMPT, ROUTING_SOURCE } from './routing-prompt.mjs';
import { invoiceOperation } from './invoice-input.mjs';

export { ROUTING_SOURCE };
export const INVOICE_ROUTING_PROMPT = ROUTING_PROMPT + `
Invoice Desk adaptation: route the user's work BEFORE extracting invoice details.
This PayPal demo is English-only. Write every user-visible title, question and reason in English, including during a recheck; the source instructions above do not change the product language.
Missing invoice amount/currency/line is an invoice-planning question, not a reason to lose a clearly identified topic.
When there is no active client or answered client question, an invoice request for "that client" or without a named client must CLARIFY if multiple customers exist. A generic service description is not a customer identity. Never use catalog order to pick a recipient.
CREATE makes a notes-only topic: it cannot invent a customer or recipient or enable invoicing.
An explicit request to record a personal expense without invoicing belongs to the budget topic, even if it mentions moving or design.
relatedIds are references only: never transfer their recipient, invoice amount or authorization to the target topic.
Pending invoice approvals are routing clues only. A chat message, including yes/continue, NEVER approves a draft.
pendingQuestion, when present, is an unresolved routing question with its original user message and candidate IDs. Add resolvesQuestion:true ONLY if the current message answers that question; otherwise false. When resolving, route the original work using the new clarification. An unrelated new request must not inherit that question's invoice details.
No projects or symbols are supplied. Return projectId:null and imports:[].`;

export function redact(value) {
  return String(value).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-|sk_|oc_sk_)[a-z0-9_-]{8,}/gi, '[key]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret|密码|密钥)\s*[=:：]\s*)[^\s,;，；]+/gi, '$1[redacted]');
}
export function routingPayload(message, topics, context = {}) {
  const clean = (value, limit) => redact(value ?? '').slice(0, limit);
  const ids = new Set(topics.map(t => t.id));
  const payload = {
    contexts: topics.map(t => ({ id: t.id, title: clean(t.title, 100), summary: clean(t.summary, 200), entities: (t.aliases ?? []).map(a => clean(a, 100)), keywords: [] })),
    states: (context.states ?? []).filter(s => ids.has(s.id)).map(s => ({ id: s.id, activity: s.activity, status: s.status })),
    historyIncomplete: false,
    corrections: (context.corrections ?? []).slice(-12).filter(c => ids.has(c.rightId))
      .map(c => ({ text: clean(c.text, 500), wrongId: c.wrongId, rightId: c.rightId })),
    recent: (context.recent ?? []).slice(-12).map(m => ({ role: m.role, text: clean(m.text, 500) })),
    attention: context.attention ?? { background: [] },
    ...(context.pendingQuestion ? { pendingQuestion: { message: clean(context.pendingQuestion.message, 4000),
      question: clean(context.pendingQuestion.question, 1000), candidateIds: context.pendingQuestion.candidateIds.filter(id => ids.has(id)) } } : {}),
    currentId: ids.has(context.currentId) ? context.currentId : null,
    text: clean(message, 4000),
  };
  while (JSON.stringify(payload).length > 24000 && payload.recent.length > 2) payload.recent.shift();
  while (JSON.stringify(payload).length > 24000 && payload.corrections.length) payload.corrections.shift();
  if (JSON.stringify(payload).length > 24000) throw Error('Routing context exceeds the local limit');
  return payload;
}

// Server policy: a fresh financial request cannot turn a guessed topic into a customer binding.
export function namedCustomerTopics(message, topics) {
  const customers = topics.filter(t => t.invoice_enabled !== false);
  const input = message.normalize('NFKC').toLowerCase();
  return customers.filter(t => [t.title, ...(t.aliases ?? [])].some(name => {
    const escaped = name.normalize('NFKC').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Chinese names do not need Latin word boundaries.
    return /[\p{Script=Han}]/u.test(name) ? input.includes(name.toLowerCase())
      : new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(input);
  }));
}
export function guardCustomerRoute(message, topics, context, route, force = false) {
  if (route.action === 'CLARIFY' || !force && !invoiceOperation(message)) return null;
  const customers = topics.filter(t => t.invoice_enabled !== false);
  const named = namedCustomerTopics(message, topics);
  if (context.corrections?.some(c => c.text === message && c.rightId === route.contextId)) return null;
  // A named customer outranks the previous foreground, including a wrong notes-only route.
  if (named.some(t => t.id === route.contextId)) return null;
  if (!named.length && route.contextId === context.currentId && customers.some(t => t.id === context.currentId)) return null;
  if (!named.length && (customers.length < 2 || topics.find(t => t.id === route.contextId)?.invoice_enabled === false)) return null;
  return { action: 'CLARIFY', contextId: null, candidateIds: customers.map(t => t.id),
    reason: 'No explicit customer binding for this invoice request.',
    question: `Do you mean ${customers.slice(0, 6).map(t => t.title.slice(0, 80)).join(' or ')}${customers.length > 6 ? ', or another configured client' : ''}? Please name the client project.` };
}
export function validateRoute(value, topics, currentId) {
  if (!value || Array.isArray(value) || !['EXISTING', 'CREATE', 'CLARIFY'].includes(value.action)) throw Error('Invalid routing decision');
  const ids = new Set(topics.map(t => t.id));
  const list = (key, max) => {
    const result = value[key] ?? [];
    if (!Array.isArray(result) || result.length > max || new Set(result).size !== result.length || result.some(id => !ids.has(id))) throw Error(`Invalid routing ${key}`);
    return result;
  };
  const relatedIds = list('relatedIds', 3), candidateIds = list('candidateIds', 16);
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 500) throw Error('Invalid routing reason');
  if (value.action === 'EXISTING' ? !ids.has(value.contextId) : value.contextId !== null) throw Error('Invalid routing target');
  if (value.resolvesQuestion !== undefined && typeof value.resolvesQuestion !== 'boolean') throw Error('Invalid clarification binding');
  if (relatedIds.includes(value.contextId)) throw Error('Reference cannot be the target');
  if (value.action === 'CLARIFY' && (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 1000 || relatedIds.length)) throw Error('Invalid routing clarification');
  if (value.action !== 'CLARIFY' && candidateIds.length) throw Error('Unexpected routing candidates');
  if (value.action === 'CREATE' && (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100 || value.historyIndependent !== true)) throw Error('New topic requires a self-contained request and title');
  return { action: value.action, contextId: value.contextId, relatedIds, candidateIds,
    title: value.action === 'CREATE' ? value.title.trim() : null,
    resolvesQuestion: value.action !== 'CLARIFY' && value.resolvesQuestion === true,
    aside: value.action === 'CREATE' && value.aside === true,
    question: value.action === 'CLARIFY' ? value.question.trim() : null, reason: value.reason.trim(),
    transition: value.action === 'EXISTING' ? (!currentId ? 'MOUNT' : currentId === value.contextId ? 'KEEP' : 'SWAP') : value.action };
}
