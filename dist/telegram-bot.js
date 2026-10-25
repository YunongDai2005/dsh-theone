/**
 * Telegram's Bot API for main chat: long-polled updates, text replies, "typing…", and binding the
 * bot to its owner. The user makes a bot with @BotFather and pastes its token; whoever then sends the
 * bot the pairing code shown in Settings becomes its owner, and only the owner reaches main chat.
 * Independent of DSH.
 */
import { randomInt } from 'node:crypto';
import { RemoteLink } from "./remote-link.js";
export const TELEGRAM_API = 'https://api.telegram.org';
/** A reply longer than this is sent in parts. */
export const TELEGRAM_TEXT_LIMIT = 4096;
/** How long Telegram holds getUpdates open when nothing arrives. */
const LONG_POLL_S = 30;
/** A plausible bot token: "<digits>:<35 or so url-safe characters>". */
export const TOKEN_PATTERN = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;
export class TelegramClient {
    base;
    /** The HTTP client; replaced in tests by a scripted server. */
    fetchImpl = (input, init) => fetch(input, init);
    constructor(base = TELEGRAM_API) {
        this.base = base;
    }
    /** Call one Bot API method; a failure carries Telegram's error code (401 for a revoked token). */
    async call(token, method, body, options = {}) {
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        let response;
        try {
            response = await this.fetchImpl(`${this.base}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
        }
        catch (error) {
            if (timeout.aborted && !options.signal?.aborted)
                throw Object.assign(new Error('TELEGRAM_TIMEOUT'), { name: 'TimeoutError' });
            throw error;
        }
        const parsed = await response.json().catch(() => ({}));
        if (!parsed.ok)
            throw Object.assign(new Error(`TELEGRAM_${parsed.error_code ?? response.status}${parsed.description ? ` ${parsed.description}` : ''}`), { code: parsed.error_code ?? response.status });
        return parsed.result;
    }
    /** The bot behind a token: its @username. */
    async me(token) {
        const me = await this.call(token, 'getMe', {});
        if (!me.username)
            throw new Error('TELEGRAM_NOT_A_BOT');
        return { username: me.username };
    }
    async send(token, chatId, text) {
        await this.call(token, 'sendMessage', { chat_id: chatId, text });
    }
    async typing(token, chatId) {
        await this.call(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }, { timeoutMs: 10_000 });
    }
}
/** The pairing code as the owner may send it: "/start 123456" (the bot's link does this) or just the digits. */
function pairs(text, code) {
    return new RegExp(`^\\s*(?:/start(?:@\\w+)?\\s+)?${code}\\s*$`).test(text);
}
/** Polling getUpdates: messages from the owner's private chat; pairing binds the first person to send the code. */
export function telegramSource(client, words) {
    let webhookCleared = false;
    return {
        timeoutMs: LONG_POLL_S * 1000,
        identity: saved => saved.token,
        label: saved => `@${saved.bot}`,
        poll: async (saved, timeoutMs, signal) => {
            let updates;
            try {
                updates = await client.call(saved.token, 'getUpdates', {
                    ...(saved.cursor ? { offset: Number(saved.cursor) } : {}), timeout: Math.round(timeoutMs / 1000), allowed_updates: ['message'],
                }, { timeoutMs: timeoutMs + 10_000, signal });
            }
            catch (error) {
                if (signal.aborted)
                    throw error;
                if (error instanceof Error && error.name === 'TimeoutError')
                    return { kind: 'ok', messages: [], cursor: saved.cursor };
                const code = error.code;
                // 401: the token was revoked in @BotFather.
                if (code === 401)
                    return { kind: 'expired' };
                // 409 with a webhook set: the bot was used elsewhere; receiving here takes it over once.
                if (code === 409 && /webhook/i.test(String(error.message)) && !webhookCleared) {
                    webhookCleared = true;
                    await client.call(saved.token, 'deleteWebhook', {}).catch(() => { });
                }
                return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
            }
            let owner = saved.owner;
            const patch = {};
            const messages = [];
            for (const update of updates) {
                const message = update.message;
                if (!message || message.chat.type !== 'private' || !message.from)
                    continue;
                const text = (message.text ?? message.caption ?? '').trim();
                if (!owner && saved.pairing && pairs(text, saved.pairing)) {
                    owner = { userId: message.from.id, chatId: message.chat.id, name: message.from.username ? `@${message.from.username}` : message.from.first_name ?? String(message.from.id) };
                    Object.assign(patch, { owner, pairing: undefined });
                    await client.send(saved.token, message.chat.id, words().paired).catch(() => { });
                    continue;
                }
                if (owner && message.from.id === owner.userId)
                    messages.push({ id: String(update.update_id), text });
            }
            const last = updates.at(-1);
            return { kind: 'ok', messages, cursor: last ? String(last.update_id + 1) : saved.cursor, ...(Object.keys(patch).length ? { patch } : {}) };
        },
    };
}
export class TelegramLink extends RemoteLink {
    client;
    constructor(client, deps, words) {
        super({ ...deps, source: telegramSource(client, words) });
        this.client = client;
    }
    status() {
        const saved = this.deps.load();
        return { ...super.status(), ...(saved?.pairing && !saved.owner ? { pairing: { bot: saved.bot, code: saved.pairing } } : {}) };
    }
    /** Check a pasted token with Telegram, then bind it and wait for the owner to send the pairing code. */
    async connect(token) {
        const trimmed = token.trim();
        if (!TOKEN_PATTERN.test(trimmed))
            throw new Error('TELEGRAM_TOKEN_INVALID');
        const { username } = await this.client.me(trimmed);
        await this.bind({ token: trimmed, bot: username, enabled: true, cursor: '', pairing: String(randomInt(100000, 1000000)) });
    }
}
