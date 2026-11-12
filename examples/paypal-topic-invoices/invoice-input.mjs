import { AppError } from './errors.mjs';

const CURRENCY = '(?:USD|EUR|GBP|euros?|dollars?|pounds?|美元|欧元|英镑|[€$£])';
const NUMBER = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?';
export function currencyCode(value) {
  return /^(?:EUR|euros?|欧元|€)$/i.test(value) ? 'EUR' : /^(?:GBP|pounds?|英镑|£)$/i.test(value) ? 'GBP' : 'USD';
}
function decimal(value) {
  const normalized = /,\d{3}(?:,|\.|$)/.test(value) ? value.replaceAll(',', '') : value.replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return `${Number(whole)}.${fraction.padEnd(2,'0')}`;
}
export function moneyMentions(text) {
  const input = String(text).normalize('NFKC');
  const pattern = new RegExp(`(?<![A-Za-z\\p{N}_.-])(?:(${CURRENCY})\\s*(${NUMBER})|(${NUMBER})\\s*(${CURRENCY}))(?![A-Za-z\\p{N}_]|[.,]\\d)`, 'giu');
  return [...input.matchAll(pattern)].flatMap(m => {
    const amount = decimal(m[2] ?? m[3]);
    return amount ? [{ amount, currency: currencyCode(m[1] ?? m[4]), start: m.index, end: m.index + m[0].length }] : [];
  });
}
export function bareAmounts(text) {
  return [...String(text).normalize('NFKC').matchAll(new RegExp(`(?<![A-Za-z\\p{N}_.-])(${NUMBER})(?![A-Za-z\\p{N}_-]|[.,]\\d)`, 'gu'))]
    .flatMap(m => { const amount = decimal(m[1]); return amount ? [{ amount, start: m.index, end: m.index + m[0].length }] : []; });
}
export function currenciesIn(text) {
  return [...String(text).matchAll(new RegExp(`(?<![A-Za-z])(${CURRENCY})(?![A-Za-z])`, 'gi'))].map(m => currencyCode(m[1]));
}
export function invoiceOperation(message) {
  if (/^\s*(?:how (?:do|does|can|to)|what (?:is|are|does)|explain\b|help me understand|如何|怎么(?:读|看|理解)|什么是)/i.test(message)) return false;
  return /\b(?:invoices?|invoiced|invoicing|bills?|billed|billing|charge[sd]?|charging)\b|发票|开票|账单|收费|收款/i.test(message);
}

// Only the selected project's USER text can establish money. No assistant/reference values.
export function groundMoney(plan, message, recent = [], drafts = []) {
  if (!['invoice_draft','invoice_update'].includes(plan.intent)) return null;
  const users = [{ text: message, source: 'current' }, ...recent.filter(m => m.role === 'user').toReversed()
    .map(m => ({ text: m.text, source: 'recent_user', message_id: m.id }))];
  const fail = () => { throw new AppError('UNSUPPORTED_INVOICE_MONEY', 'The invoice amount or currency is not supported by the user request. Ask for the exact total and currency.', 422); };
  const target = drafts.find(d => d.id === plan.proposal_id);
  const currency = plan.currency ?? target?.currency;
  if (plan.amount !== null) {
    // Revisions must use this turn's requested replacement, never a historical amount.
    const sources = plan.intent === 'invoice_update' ? users.slice(0,1) : users;
    for (const source of sources) {
      const numbers = bareAmounts(source.text), pairs = moneyMentions(source.text);
      if (!numbers.length && !pairs.length) {
        if (/\d/.test(source.text)) fail();
        continue;
      }
      const last = plan.intent === 'invoice_update' ? [...numbers,...pairs].sort((a,b) => a.start-b.start).at(-1) : null;
      if (last && last.amount !== plan.amount) fail();
      const pair = pairs.find(p => p.amount === plan.amount && p.currency === currency);
      if (pair) return { source: source.source, ...(source.message_id ? { message_id: source.message_id } : {}), amount: plan.amount, currency };
      if (!pairs.length && numbers.some(n => n.amount === plan.amount)) {
        const currencySource = users.find(u => currenciesIn(u.text).length);
        if (currencySource && currenciesIn(currencySource.text).at(-1) === currency ||
            plan.intent === 'invoice_update' && !plan.currency && target?.currency === currency)
          return { source: source.source, ...(source.message_id ? { message_id: source.message_id } : {}), amount: plan.amount, currency };
      }
      // A newer explicit number cannot be replaced with an older invoice total.
      fail();
    }
    fail();
  }
  if (plan.currency !== null && !currenciesIn(message).includes(plan.currency)) fail();
  return { source: 'current', ...(plan.currency ? { currency: plan.currency } : {}) };
}
