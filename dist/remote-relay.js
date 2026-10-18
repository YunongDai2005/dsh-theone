import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
/** An approval or question not answered in the app within this long is declined. */
export const ASK_TIMEOUT_MS = 10 * 60_000;
export const RELAY_WORDS = {
    zh: {
        noMainChat: '还没有 TheOne 主聊天。请先在电脑上打开一次「TheOne · 主聊天」，之后在这里说的话就会进到那里。',
        notDelivered: (reason) => `这条没能交给主聊天：${reason}`,
        failed: '这条没有完成，详情可以在电脑上的主聊天里看。',
        stopped: '这条已经停止了。',
        approval: (what) => `需要你确认一步操作：\n${what}\n\n回 1 允许，回 2 拒绝（10 分钟内不回按拒绝处理）。`,
        approvalHint: '请回 1 允许，或回 2 拒绝。',
        question: (header, text, options, multi) => [header ? `【${header}】` : '', text, '',
            ...options.map((option, index) => `${index + 1}. ${option}`), '',
            options.length ? (multi ? '回编号选择，可以选多个（用空格隔开），也可以直接打字回答。' : '回编号选择，也可以直接打字回答。') : '直接打字回答。'],
        questionHint: '回编号或直接打字回答。',
        unanswered: '（10 分钟内没有回答）',
    },
    en: {
        noMainChat: 'There is no TheOne main chat yet. Open "TheOne · Main chat" on your computer once; after that, what you say here goes there.',
        notDelivered: (reason) => `This could not be passed to main chat: ${reason}`,
        failed: 'This did not finish; main chat on your computer has the details.',
        stopped: 'This was stopped.',
        approval: (what) => `A step needs your approval:\n${what}\n\nReply 1 to allow, 2 to deny (no reply within 10 minutes denies it).`,
        approvalHint: 'Reply 1 to allow or 2 to deny.',
        question: (header, text, options, multi) => [header ? `[${header}]` : '', text, '',
            ...options.map((option, index) => `${index + 1}. ${option}`), '',
            options.length ? (multi ? 'Reply with numbers (several, separated by spaces), or type an answer.' : 'Reply with a number, or type an answer.') : 'Type your answer.'],
        questionHint: 'Reply with a number, or type an answer.',
        unanswered: '(not answered within 10 minutes)',
    },
};
/** Lines joined, without leading blank lines or runs of them. */
const lines = (parts) => parts.filter((line, index, all) => line || all[index - 1]).join('\n').trim();
export class RemoteRelay {
    ctx;
    host;
    channel;
    /** How long an approval or question waits for an answer in the app. */
    askTimeoutMs = ASK_TIMEOUT_MS;
    asking;
    /** Asks wait their turn: one question in the app at a time. */
    queue = Promise.resolve();
    /** Main chat turns already answered in the app ("<session>:<turn end seq>"). */
    answered = new Set();
    prefix;
    constructor(ctx, host, channel) {
        this.ctx = ctx;
        this.host = host;
        this.channel = channel;
        this.prefix = `${channel.name}:`;
    }
    /** Answer main chat's turns for the app, and take approvals and questions for them. */
    apply() {
        const on = this.ctx.on.bind(this.ctx);
        this.ctx.effect(() => on('session/event', ((session, event) => {
            if (event.type === 'turn/end' && session.id === this.host.gatewayId())
                void this.answerTurn(session.id, event.seq, event.data.reason?.kind).catch(() => { });
        })));
        // Ahead of DSH's forwarding to the browser: the person who asked is on their phone.
        this.ctx.effect(() => on('approval/request', ((request, next) => this.approval(request, next)), { prepend: true }));
        this.ctx.effect(() => on('user-questions/request', ((request, next) => this.question(request, next)), { prepend: true }));
    }
    /** Words in main chat's language. */
    words() {
        const gatewayId = this.host.gatewayId();
        return gatewayId && /^en/.test(this.host.locale(gatewayId)) ? RELAY_WORDS.en : RELAY_WORDS.zh;
    }
    /** A message from the owner: the answer to a pending question, or a message for main chat. */
    async receive(id, text) {
        const asking = this.asking;
        if (asking) {
            if (!asking.read(text))
                await this.channel.send(asking.hint).catch(() => { });
            return;
        }
        const words = this.words();
        const gatewayId = this.host.gatewayId();
        if (!gatewayId) {
            await this.channel.send(words.noMainChat).catch(() => { });
            return;
        }
        try {
            await this.prompt(gatewayId, `${this.prefix}${id}`, text);
        }
        catch (error) {
            await this.channel.send(words.notDelivered(error instanceof Error ? error.message : String(error))).catch(() => { });
            return;
        }
        void this.channel.typing?.().catch(() => { });
    }
    /** Send a notice to the owner if the app is bound; false when it is not, or sending failed. */
    async notify(text) {
        if (!this.channel.available())
            return false;
        try {
            await this.channel.send(text);
            return true;
        }
        catch {
            return false;
        }
    }
    /** A note in main chat, where the user looks (for example, that the app's login expired). */
    note(text) {
        const gatewayId = this.host.gatewayId();
        const gateway = gatewayId ? this.ctx.agents.get(SessionId(gatewayId)) : undefined;
        gateway?.followup(createUserMessage({ source: { kind: 'theone-note', form: 'notice' }, content: [{ type: 'text', text }] }));
    }
    /** Into main chat's queue, as the browser sends it; DSH's session controller wakes main chat if it is not loaded. */
    async prompt(gatewayId, requestId, text) {
        const controller = this.ctx.get('sessionController');
        if (controller) {
            await controller.prompt({ requestId, sessionId: gatewayId, mode: 'queue', content: [{ type: 'text', text }] }, AbortSignal.timeout(60_000));
            return;
        }
        const agent = this.ctx.agents.get(SessionId(gatewayId));
        if (!agent)
            throw new Error('main chat is not loaded');
        agent.followup(createUserMessage({ source: { kind: 'user', rpcId: requestId }, content: [{ type: 'text', text }] }));
    }
    /** Main chat's turn from `turn/start` to the event at `endSeq` (the open turn when absent). */
    turnEvents(gatewayId, endSeq) {
        const events = this.ctx.agents.get(SessionId(gatewayId))?.session.snapshotEvents() ?? [];
        const end = endSeq === undefined ? events.length - 1 : events.findLastIndex(event => event.seq === endSeq);
        if (end < 0)
            return [];
        const start = events.slice(0, end + 1).findLastIndex(event => event.type === 'turn/start');
        return start < 0 ? [] : events.slice(start, end + 1);
    }
    /** The turn answers a message sent from this app. */
    fromChannel(events) {
        return events.some(event => event.type === 'user/message' && event.data.source.kind === 'user'
            && String(event.data.source.rpcId ?? '').startsWith(this.prefix));
    }
    async answerTurn(gatewayId, endSeq, reason) {
        const key = `${gatewayId}:${endSeq}`;
        if (this.answered.has(key))
            return;
        const events = this.turnEvents(gatewayId, endSeq);
        if (!this.fromChannel(events))
            return;
        this.answered.add(key);
        // The final words of the reply; steps before it narrate tool calls.
        const reply = events.findLast(event => event.type === 'assistant/message'
            && event.data.message.content.some(block => block.type === 'text' && block.text.trim()));
        const said = reply?.type === 'assistant/message' ? reply.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim() : '';
        const words = this.words();
        const message = said || (reason === 'aborted' ? words.stopped : reason && reason !== 'completed' ? words.failed : '');
        if (message)
            await this.channel.send(message);
    }
    /** Answering a message from this app right now: questions for it go to the app. */
    askingHere(agent) {
        const gatewayId = this.host.gatewayId();
        return !!agent && agent.id === gatewayId && this.channel.available() && this.fromChannel(this.turnEvents(gatewayId));
    }
    async approval(request, next) {
        if (!this.askingHere(request.agent))
            return next();
        const display = request.displayReason;
        const words = this.words();
        const what = (words === RELAY_WORDS.zh ? display?.zh : undefined) ?? display?.en ?? (typeof request.reason === 'string' ? request.reason : undefined) ?? String(request.toolName);
        return await this.ask(words.approval(what), words.approvalHint, reply => {
            const answer = reply.trim().toLowerCase();
            if (/^(1|允许|同意|可以|好|行|y|yes|allow|ok)$/.test(answer))
                return 'allowed-once';
            if (/^(2|拒绝|不|不行|不要|n|no|deny)$/.test(answer))
                return 'rejected';
            return undefined;
        }, 'rejected', request.signal, 'cancelled');
    }
    async question(request, next) {
        if (!this.askingHere(request.agent) || !Array.isArray(request.questions))
            return next();
        const words = this.words();
        const answers = [];
        for (const item of request.questions) {
            const options = (item.options ?? []).map(option => option.description ? `${option.label}：${option.description}` : option.label);
            const body = item.detail ? `${item.question}\n\n${item.detail}` : item.question;
            answers.push(await this.ask(lines(words.question(item.header, body, options, !!item.multiSelect)), words.questionHint, reply => {
                const answer = reply.trim();
                if (!answer)
                    return undefined;
                const numbers = answer.split(/[\s,，、]+/).map(part => Number(part));
                const valid = item.options?.length && numbers.every(n => Number.isInteger(n) && n >= 1 && n <= item.options.length)
                    && (item.multiSelect || numbers.length === 1);
                return valid ? { id: item.id, selected: [...new Set(numbers)].map(n => item.options[n - 1].label) } : { id: item.id, selected: [], custom: answer };
            }, { id: item.id, selected: [], custom: words.unanswered }, request.signal));
        }
        return { answers };
    }
    /**
     * Put one question to the app and wait for the owner's reply, `timeout` without one, or `cancelled`
     * when the request is withdrawn.
     */
    ask(prompt, hint, read, timeout, signal, cancelled = timeout) {
        const turn = this.queue.then(() => new Promise(resolve => {
            if (signal?.aborted) {
                resolve(cancelled);
                return;
            }
            const finish = (value) => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (this.asking === asking)
                    this.asking = undefined;
                resolve(value);
            };
            const abort = () => finish(cancelled);
            const timer = setTimeout(() => finish(timeout), this.askTimeoutMs);
            const asking = { hint, read: reply => {
                    const value = read(reply);
                    if (value === undefined)
                        return false;
                    finish(value);
                    return true;
                } };
            this.asking = asking;
            signal?.addEventListener('abort', abort, { once: true });
            void this.channel.send(prompt).catch(() => finish(timeout));
        }));
        this.queue = turn.catch(() => { });
        return turn;
    }
}
