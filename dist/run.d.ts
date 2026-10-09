import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';
/** Finish code with which the main chat redoes its attempt after the Worker retried the step being shown. */
export declare const RESTART_CODE = "THEONE_WORKER_RETRY";
/**
 * One Worker activity mirrored into the main chat. Each Worker step is shown as one main-chat step
 * carrying the same reasoning, text and tool calls, so it reads like an ordinary conversation; the
 * main chat's tool calls then resolve with the Worker's results instead of running a second time.
 */
export declare class WorkerRun {
    readonly worker: Agent;
    readonly gateway: Agent;
    readonly inputId: string;
    private readonly maxChars;
    private readonly beforeToolCalls;
    private readonly steps;
    /** Main-chat steps opened for this run; step n shows Worker step n. */
    private shown;
    private restarting;
    private characters;
    private waiters;
    /** Worker results per call id, consumed in order: some providers reuse ids such as `call_0` every step. */
    private readonly results;
    private readonly disposers;
    /** Main-chat steering message id → its copy in the Worker inbox. */
    readonly forwarded: Map<string, string>;
    failure?: Error;
    outcome?: TurnEndReason;
    done: boolean;
    settled: Promise<void>;
    constructor(ctx: Context, worker: Agent, gateway: Agent, inputId: string, maxChars: number, beforeToolCalls: (names: string[]) => void);
    /** Related topics whose news this run's briefing carried, and those the Worker then looked up. */
    briefed: string[];
    readonly lookedUp: Set<string>;
    /** The Worker recorded facts itself this run, so no extraction is needed afterwards. */
    recordedFacts: boolean;
    /** The request this run answers, as the user wrote it. */
    request: string;
    /** The end of what the Worker has written so far, for judging messages sent meanwhile. */
    progress(limit?: number): string;
    /** Give the Worker its context and input; the run ends when the Worker is idle again. */
    start(contexts: UserMessage[], input: UserMessage): void;
    /** Steering sent to the main chat during the reply reaches the Worker at its next step. */
    get canForward(): boolean;
    forward(message: UserMessage): void;
    withdraw(messageId: string): void;
    /** Whether the Worker has started a step the main chat has not shown. */
    get unshown(): boolean;
    /** Resolve once the Worker is idle or has started a step the main chat has not shown yet. */
    idleOrUnshown(): Promise<void>;
    cancel(): void;
    dispose(): void;
    /** The Worker's own outcome for one of its tool calls, shown as the main chat's result. */
    toolResult(callId: string, signal: AbortSignal): Promise<ToolExecutionResult>;
    /** Stream the next Worker step, or the same one again after a retry, as one main-chat attempt. */
    stream(signal?: AbortSignal): AsyncIterable<StreamChunk>;
    private fail;
    private entry;
    private wake;
}
