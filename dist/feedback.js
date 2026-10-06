import { redactRoutingText } from "./routing-policy.js";
/** Where reports go: a small Cloudflare Worker run by TheOne's maintainer (server/feedback). */
export const FEEDBACK_URL = 'https://feedback.yulid.org/v1/reports';
export const FEEDBACK_EMAIL = 'theone@yulid.org';
export const FEEDBACK_LIMITS = { description: 4000, contact: 200, routes: 30, replyText: 8000, body: 60000 };
const MINUTE = 60000;
/** Strings as they may leave this computer: secrets, emails, addresses and the home folder removed. */
export function scrub(value, home) {
    if (typeof value === 'string') {
        let text = redactRoutingText(value);
        if (home && home.length > 1)
            text = text.split(home).join('~');
        return text;
    }
    if (Array.isArray(value))
        return value.map(item => scrub(item, home));
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, home)]));
    return value;
}
/** A decision's reason when it is one of TheOne's own codes; a model's free-text reason may quote the message. */
function reasonCode(reason) {
    return /^[a-z][\w:-]{0,59}$/i.test(reason) ? reason : 'model';
}
/** Recent routes without their text or topics: what happened, how, how long, and any error code. */
export function routeDigest(routes, now = Date.now()) {
    return routes.slice(0, FEEDBACK_LIMITS.routes).map(route => ({
        minutesAgo: Math.max(0, Math.round((now - route.at) / MINUTE)),
        action: route.decision.action,
        reason: reasonCode(route.decision.reason),
        status: route.status,
        ...(route.receipt ? { via: route.receipt.mode, ...(route.receipt.model ? { model: route.receipt.model } : {}),
            ...(route.receipt.elapsedMs !== undefined ? { ms: route.receipt.elapsedMs } : {}), ...(route.receipt.errorCode ? { error: route.receipt.errorCode } : {}) } : {}),
        ...(route.correctedTo ? { corrected: route.correctedTo !== route.decision.contextId } : {}),
    }));
}
const blockText = (blocks) => blocks.flatMap(block => block.type === 'text' && block.text ? [block.text] : []).join('');
/**
 * One exchange in a session: the user message `messageId` (or, failing that, the latest user message
 * with the same text) and every assistant text up to the next user message.
 */
export function exchange(events, messageId, sameText) {
    let start = events.findIndex(event => event.type === 'user/message' && event.data.id === messageId);
    if (start < 0 && sameText !== undefined) {
        for (let index = events.length - 1; index >= 0; index--) {
            const event = events[index];
            if (event.type === 'user/message' && event.data.source.kind === 'user' && blockText(event.data.content).trim() === sameText.trim()) {
                start = index;
                break;
            }
        }
    }
    if (start < 0)
        return undefined;
    const first = events[start];
    if (first.type !== 'user/message')
        return undefined;
    const replies = [];
    for (const event of events.slice(start + 1)) {
        if (event.type === 'user/message' && event.data.source.kind === 'user')
            break;
        if (event.type === 'assistant/message')
            replies.push(blockText(event.data.message.content));
    }
    return { user: blockText(first.data.content), reply: replies.join(''), steps: replies.length };
}
const count = (text, pattern) => (text.match(pattern) ?? []).length;
/**
 * Whether main chat showed what the topic's own session said, and signs of garbled text in either:
 * replacement characters (U+FFFD), stray control characters, and long runs of one repeated character.
 */
export function compareReplies(main, worker) {
    let first = 0;
    while (first < main.length && first < worker.length && main[first] === worker[first])
        first++;
    const identical = main === worker;
    const signs = (text) => ({ chars: text.length, replacement: count(text, /�/g),
        control: count(text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g), repeatedRuns: count(text, /(.)\1{19,}/gsu) });
    return { identical, ...(identical ? {} : { firstDifference: first }), main: signs(main), worker: signs(worker) };
}
/** Text around the first difference, so a long reply still shows where the two part ways. */
function excerpt(text, around) {
    if (text.length <= FEEDBACK_LIMITS.replyText)
        return text;
    const start = around === undefined ? 0 : Math.max(0, Math.min(text.length - FEEDBACK_LIMITS.replyText, around - FEEDBACK_LIMITS.replyText / 2));
    return (start ? '…' : '') + text.slice(start, start + FEEDBACK_LIMITS.replyText) + (start + FEEDBACK_LIMITS.replyText < text.length ? '…' : '');
}
/** The part of a report about one message: always the comparison, the texts only when the user agreed. */
export function replySection(route, main, worker, includeText, now = Date.now()) {
    const comparison = main && worker ? compareReplies(main.reply, worker.reply) : undefined;
    return {
        route: routeDigest([route], now)[0],
        found: { mainChat: !!main, topicSession: !!worker },
        ...(main ? { mainSteps: main.steps } : {}), ...(worker ? { topicSteps: worker.steps } : {}),
        ...(comparison ? { comparison } : {}),
        ...(includeText ? {
            message: (main ?? worker)?.user.slice(0, 2000),
            ...(main ? { mainChatReply: excerpt(main.reply, comparison?.firstDifference) } : {}),
            ...(worker ? { topicSessionReply: excerpt(worker.reply, comparison?.firstDifference) } : {}),
        } : {}),
    };
}
/**
 * The report to send: the draft the user saw plus what they typed. The draft comes back from the
 * page, so it is checked and scrubbed again here; anything malformed is refused, not repaired.
 */
export function finalReport(input, version, home) {
    const draft = input.draft;
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const contact = typeof input.contact === 'string' ? input.contact.trim() : '';
    if (!draft || typeof draft !== 'object' || draft.v !== 1 || draft.app !== 'theone')
        throw new Error('INVALID_INPUT');
    if (!draft.diagnostics || typeof draft.diagnostics !== 'object' || Array.isArray(draft.diagnostics))
        throw new Error('INVALID_INPUT');
    if (draft.reply != null && (typeof draft.reply !== 'object' || Array.isArray(draft.reply)))
        throw new Error('INVALID_INPUT');
    if (!description)
        throw new Error('DESCRIPTION_REQUIRED');
    if (description.length > FEEDBACK_LIMITS.description || contact.length > FEEDBACK_LIMITS.contact)
        throw new Error('TOO_LARGE');
    const report = { v: 1, app: 'theone', version, lang: input.lang === 'zh' ? 'zh' : 'en', description,
        ...(contact ? { contact } : {}),
        diagnostics: scrub(draft.diagnostics, home),
        ...(draft.reply ? { reply: scrub(draft.reply, home) } : {}) };
    if (JSON.stringify(report).length > FEEDBACK_LIMITS.body)
        throw new Error('TOO_LARGE');
    return report;
}
/** Send a report; resolves to its id, or throws RATE_LIMITED, REJECTED, UNREACHABLE or SERVER_ERROR. */
export async function sendReport(report, url = FEEDBACK_URL, fetcher = fetch) {
    let response;
    try {
        response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(15000) });
    }
    catch {
        throw new Error('UNREACHABLE');
    }
    if (response.status === 429)
        throw new Error('RATE_LIMITED');
    if (response.status >= 400 && response.status < 500)
        throw new Error('REJECTED');
    const body = await response.json().catch(() => undefined);
    if (!response.ok || typeof body?.id !== 'string' || !/^FB-[A-Z0-9]{4,12}$/.test(body.id))
        throw new Error('SERVER_ERROR');
    return body.id;
}
