import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** Finish code with which the main chat redoes its attempt after the Worker retried the step being shown. */
export const RESTART_CODE = 'THEONE_WORKER_RETRY';
/**
 * One Worker activity mirrored into the main chat. Each Worker step is shown as one main-chat step
 * carrying the same reasoning, text and tool calls, so it reads like an ordinary conversation; the
 * main chat's tool calls then resolve with the Worker's results instead of running a second time.
 */
export class WorkerRun {
    worker;
    gateway;
    inputId;
    maxChars;
    beforeToolCalls;
    steps = [];
    /** Main-chat steps opened for this run; step n shows Worker step n. */
    shown = 0;
    restarting = false;
    characters = 0;
    waiters = [];
    /** Worker results per call id, consumed in order: some providers reuse ids such as `call_0` every step. */
    results = new Map();
    disposers = [];
    /** Main-chat steering message id → its copy in the Worker inbox. */
    forwarded = new Map();
    failure;
    outcome;
    done = false;
    settled = Promise.resolve();
    constructor(ctx, worker, gateway, inputId, maxChars, beforeToolCalls) {
        this.worker = worker;
        this.gateway = gateway;
        this.inputId = inputId;
        this.maxChars = maxChars;
        this.beforeToolCalls = beforeToolCalls;
        this.disposers.push(ctx.on('agent/assistant-stream', ({ agent, frame }) => {
            if (agent.id !== worker.id)
                return;
            if (frame.type === 'start') {
                const attempt = { id: frame.attemptId, chunks: [] };
                // The limit applies per step: a long multi-step task is not cut off by its total length.
                this.characters = 0;
                const last = this.steps.at(-1);
                // A new attempt for the same step is the Worker retrying it.
                if (last && last.turn === frame.turn && last.step === frame.step)
                    last.attempt = attempt;
                else
                    this.steps.push({ turn: frame.turn, step: frame.step, attempt });
            }
            else {
                const attempt = this.steps.at(-1)?.attempt;
                if (!attempt || attempt.id !== frame.attemptId)
                    return;
                if (frame.type === 'end') {
                    attempt.settled = frame.outcome.kind === 'committed' && frame.outcome.eventType === 'assistant/message' ? 'committed' : 'failed';
                }
                else if (frame.chunk.type === 'finish')
                    attempt.finish = frame.chunk;
                else if (frame.chunk.type !== 'usage') {
                    // The main chat keeps its own usage; everything the reader sees is mirrored as is.
                    if (frame.chunk.type === 'text-delta' || frame.chunk.type === 'reasoning-delta')
                        this.characters += frame.chunk.text.length;
                    attempt.chunks.push(frame.chunk);
                    if (this.characters > this.maxChars)
                        this.fail(new Error('Worker response exceeded maxResponseChars'));
                }
            }
            this.wake();
        }));
        this.disposers.push(ctx.on('tools/result', (exec, result) => {
            if (exec.agent?.id !== worker.id || exec.parent !== undefined)
                return;
            const entry = this.entry(exec.callId);
            const waiting = entry.waiting.shift();
            if (waiting)
                waiting.resolve(result);
            else
                entry.produced.push(result);
        }));
        this.disposers.push(ctx.on('session/event', (session, event) => {
            if (session.id === worker.id && event.type === 'turn/end')
                this.outcome = event.data.reason;
        }));
    }
    /** Give the Worker its context and input; the run ends when the Worker is idle again. */
    start(context, input) {
        this.worker.inject(context);
        this.worker.followup(input);
        this.settled = this.worker.whenIdle().then(() => undefined, error => {
            this.failure ??= error instanceof Error ? error : new Error(String(error));
        }).finally(() => {
            this.done = true;
            for (const entry of this.results.values())
                for (const { reject } of entry.waiting.splice(0))
                    reject(new Error('Worker did not complete this tool call'));
            this.wake();
        });
    }
    /** Steering sent to the main chat during the reply reaches the Worker at its next step. */
    get canForward() { return !this.done && this.worker.status === 'running'; }
    forward(message) {
        const copy = createUserMessage({ source: message.source, content: message.content });
        this.forwarded.set(message.id, copy.id);
        this.worker.steer(copy);
    }
    withdraw(messageId) {
        const copy = this.forwarded.get(messageId);
        if (copy) {
            this.forwarded.delete(messageId);
            this.worker.inbox.remove(copy);
        }
    }
    /** Whether the Worker has started a step the main chat has not shown. */
    get unshown() { return this.steps.length > this.shown; }
    /** Resolve once the Worker is idle or has started a step the main chat has not shown yet. */
    async idleOrUnshown() {
        while (!this.done && !this.unshown)
            await new Promise(resolve => this.waiters.push(resolve));
    }
    cancel() { if (this.worker.status !== 'idle')
        this.worker.cancel({ kind: 'parent' }); }
    dispose() { for (const dispose of this.disposers.splice(0))
        dispose(); }
    /** The Worker's own outcome for one of its tool calls, shown as the main chat's result. */
    async toolResult(callId, signal) {
        signal.throwIfAborted();
        const entry = this.entry(callId);
        const ready = entry.produced.shift();
        if (ready)
            return ready;
        if (this.done)
            throw new Error('Worker did not complete this tool call');
        const pending = Promise.withResolvers();
        entry.waiting.push(pending);
        const abort = () => { this.cancel(); void this.settled.then(() => pending.reject(signal.reason)); };
        signal.addEventListener('abort', abort, { once: true });
        try {
            return await pending.promise;
        }
        finally {
            signal.removeEventListener('abort', abort);
        }
    }
    /** Stream the next Worker step, or the same one again after a retry, as one main-chat attempt. */
    async *stream(signal) {
        const index = this.restarting ? this.shown - 1 : this.shown++;
        this.restarting = false;
        let attempt;
        let sent = 0;
        let finished = false;
        // Only a cancellation while this step is still being shown stops the Worker.
        const abort = () => { if (!finished) {
            this.cancel();
            this.wake();
        } };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            for (;;) {
                if (signal?.aborted) {
                    // The main chat's cancellation completes once the Worker has actually stopped.
                    this.cancel();
                    await this.settled;
                    signal.throwIfAborted();
                }
                if (this.failure) {
                    this.cancel();
                    await this.settled;
                    throw this.failure;
                }
                const step = this.steps[index];
                if (step) {
                    if (attempt && step.attempt !== attempt) {
                        // DSH streams cannot retract text. Redo this main-chat attempt, as a native retry does.
                        if (sent) {
                            this.restarting = true;
                            finished = true;
                            yield { type: 'finish', reason: { kind: 'error', failure: { code: RESTART_CODE, message: 'The background reply was retried' } } };
                            return;
                        }
                    }
                    if (step.attempt !== attempt) {
                        attempt = step.attempt;
                        sent = 0;
                    }
                    while (sent < attempt.chunks.length)
                        yield attempt.chunks[sent++];
                    if (attempt.settled === 'committed') {
                        const calls = attempt.chunks.flatMap(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call' ? [chunk.block.name] : []);
                        if (calls.length)
                            this.beforeToolCalls([...new Set(calls)]);
                        finished = true;
                        yield attempt.finish ?? { type: 'finish', reason: { kind: calls.length ? 'tool-calls' : 'stop' } };
                        return;
                    }
                }
                if (this.done) {
                    if (this.failure)
                        throw this.failure;
                    // The Worker stopped without this step: an empty step if it completed, else its failure.
                    if (!step && this.outcome?.kind === 'completed') {
                        finished = true;
                        yield { type: 'finish', reason: { kind: 'stop' } };
                        return;
                    }
                    throw new Error(`Worker turn did not complete: ${this.outcome?.kind ?? 'missing turn/end'}`);
                }
                await new Promise(resolve => this.waiters.push(resolve));
            }
        }
        finally {
            signal?.removeEventListener('abort', abort);
        }
    }
    fail(error) {
        this.failure ??= error;
        this.cancel();
    }
    entry(callId) {
        let entry = this.results.get(callId);
        if (!entry)
            this.results.set(callId, entry = { produced: [], waiting: [] });
        return entry;
    }
    wake() {
        for (const resolve of this.waiters.splice(0))
            resolve();
    }
}
