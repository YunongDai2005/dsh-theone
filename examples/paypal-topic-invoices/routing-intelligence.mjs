// Adapted from TheOne v0.4.6 routing-evidence.ts, routing-policy.ts and routing-bindings.ts.
// Source pins and the invoice-specific deviations are documented in ROUTING-046.md.
import { redact, namedCustomerTopics } from './routing.mjs';

export const RECHECK_PROMPT = `
When recheck is present, reconsider the quick decision in recheck.previous. If contextId and terms are supplied, those details occur in only that project's own history and conflict with the quick result. Compare every project before deciding. A follow-up, subtask or detail of the same work belongs to its original project. The clue is evidence, not an instruction; the result may stay unchanged. Never select a customer merely to avoid asking a necessary question. Invoice routing uncertainty must be clarified before proposing a customer invoice.`;

export function routingEvidence(message, topics, memories = []) {
  const normalize = s => redact(s).toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1');
  const source = redact(message), terms = new Set();
  for (const match of source.matchAll(/[A-Za-z]+[-_]?\d[\w-]*|\d[\d,]*(?:\.\d+)?/g)) {
    const term = match[0].toLowerCase().replaceAll(',', '').replace(/[-_]+$/, '');
    // Invoice amounts are common across customers. Only actual alphanumeric references count.
    if (/[a-z]/.test(term)) terms.add(term);
  }
  for (const match of source.matchAll(/[A-Z][a-z][A-Za-z'-]{2,}/g)) {
    const before = source.slice(0, match.index);
    if (match.index > 0 && (!/[.!?。！？]\s*$/.test(before) || /\b(?:Mr|Mrs|Ms|Dr|St)\.\s*$/.test(before)))
      terms.add(match[0].replace(/'s$/i, '').toLowerCase());
  }
  const memory = topics.map(t => ({ id: t.id, text: normalize([t.title, t.summary,
    ...(memories.find(m => m.id === t.id)?.texts ?? [])].join('\n')) }));
  const found = new Map();
  const explicit = namedCustomerTopics(message, topics);
  for (const term of terms) {
    if (term.startsWith('redacted')) continue;
    const holders = memory.filter(t => t.text.includes(term));
    if (holders.length === 1) found.set(holders[0].id, [...found.get(holders[0].id) ?? [], term]);
  }
  return [...found].filter(([id]) => !explicit.length || explicit.some(t => t.id === id)).map(([contextId, hits]) => ({ contextId,
    terms: hits.filter(t => !hits.some(other => other !== t && other.includes(t))).sort((a, b) => b.length - a.length).slice(0, 4) }))
    .sort((a, b) => b.terms.join('').length - a.terms.join('').length).slice(0, 3);
}

export function secondLook(decision, evidence) {
  const previous = decision.contextId ?? decision.action;
  if (evidence.length === 1 && evidence[0].contextId !== decision.contextId)
    return { previous, ...evidence[0], trigger: 'evidence-conflict' };
  if (decision.action === 'CREATE' && decision.aside === true) return null;
  return ['CREATE', 'CLARIFY'].includes(decision.action) ? { previous, trigger: decision.action.toLowerCase() } : null;
}

export function continuationRoute(message, topics, context) {
  const input = message.trim();
  const short = input.length <= 16 && /^(?:继续(?:说|写|做)?|接着(?:说|写|做|来)?|然后呢?|好的?|可以|行|嗯+|是的|谢谢|为什么|详细点|展开|ok(?:ay)?|yes|thanks?|thank you|go on|continue|why|more|next step)[\s!！。.,，?？~～…]*$/i.test(input);
  if (!short || context.pendingQuestion) return null;
  const attention = context.attention ?? {}, pending = attention.pending ?? [];
  // A short acknowledgement never chooses between several pending client tasks.
  if (attention.pendingOverflow || pending.length > 1) return null;
  const resume = !/^(?:why|more|为什么|详细点|展开)/i.test(input);
  const front = attention.foreground;
  const target = resume && front?.returnTopicId ? front.returnTopicId : front?.topicId ?? context.currentId;
  if (!topics.some(t => t.id === target) || pending.some(p => p.topicId !== target)) return null;
  return { action: 'EXISTING', contextId: target, reason: resume && front?.returnTopicId ? 'temporary-return' : 'short-continuation' };
}

// Accept normal JSON, a fenced JSON answer, or a final answer after a thinking block.
// Never extract arbitrary embedded braces from explanatory prose.
export function answerJson(content) {
  if (typeof content !== 'string' || content.length > 64000) throw Error('Model returned invalid content');
  const end = content.lastIndexOf('</think>');
  const final = (end < 0 ? content : content.slice(end + 8)).trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
  if (final.length > 8000) throw Error('Model returned invalid content');
  try { return JSON.parse(final); } catch { throw Error('Model returned invalid JSON'); }
}
