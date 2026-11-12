import { moneyMentions } from './invoice-input.mjs';
// Deterministic selectors for local REVIEW drafts. A model's guess is not a selector.
export function selectDraft(message, drafts) {
  const input = message.normalize('NFKC').toLowerCase();
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numbered = drafts.filter(p => input.includes(p.payload.detail.invoice_number.toLowerCase()));
  if (numbered.length) return numbered.length === 1 ? numbered[0].id : null;
  const matches = drafts.filter(p => {
    const item = p.payload.items[0], name = item.name.normalize('NFKC').toLowerCase();
    const service = name.length >= 3 && new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:["']?${escape(name)}["']? (?:draft|invoice)|(?:draft|invoice) for ["']?${escape(name)}["']?(?=$|[^\\p{L}\\p{N}]))`, 'u').test(input);
    const money = moneyMentions(input).some(m => {
      if (m.amount !== item.unit_amount.value || m.currency !== item.unit_amount.currency_code) return false;
      const before = input.slice(0,m.start), after = input.slice(m.end);
      // The requested replacement after to/into must not select another draft by accident.
      if (/(?:\b(?:to|into)|改成|改为|调整为|变成)\s*$/i.test(before)) return false;
      return /^\s*(?:的|那(?:张|份))?\s*(?:invoice\b|draft\b|发票|账单|草稿)/i.test(after)
        || /(?:invoice|draft)\s+(?:for|of)\s*$/i.test(before)
        || /(?:发票|账单|草稿)(?:金额)?(?:为|是)?\s*$/u.test(before);
    });
    return service || money;
  });
  return matches.length === 1 ? matches[0].id : null;
}
