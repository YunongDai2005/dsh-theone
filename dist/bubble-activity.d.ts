import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { Decision } from './types.ts';
import type { WorkerRun } from './run.ts';
import type { BubbleEventData, BubbleGateway, BubbleWorkItem, QueueReason } from './bubble-types.ts';
/** Observations only: never schedules, cancels, routes or writes to a session. */
export declare class BubbleActivity {
    private readonly items;
    private readonly claimed;
    private readonly listeners;
    subscribe(listener: (events: BubbleEventData[], gatewayId: string | null) => void): () => void;
    publish(events?: BubbleEventData[], gatewayId?: string | null): void;
    snapshot(): BubbleWorkItem[];
    private find;
    input(agent: Agent, message: UserMessage): BubbleWorkItem;
    claim(agent: Agent, message: UserMessage): void;
    batch(agent: Agent, messages: UserMessage[]): void;
    releaseClaim(gatewayId: string, messageIds?: string[]): void;
    routing(agent: Agent, message: UserMessage): void;
    assign(agent: Agent, message: UserMessage, decision: Decision, temporary?: BubbleWorkItem['temporary']): void;
    queue(agent: Agent, message: UserMessage, reason: QueueReason, contextId?: string): void;
    starting(agent: Agent, message: UserMessage, contextId: string, waitingProject?: boolean): void;
    register(run: WorkerRun, contextId: string, lane: 'foreground' | 'background'): void;
    restore(run: WorkerRun): void;
    observe(run: WorkerRun): void;
    forward(run: WorkerRun, message: UserMessage): void;
    discard(gatewayId: string, messageId: string): void;
    standalone(agent: Agent, message: UserMessage, phase: BubbleWorkItem['phase']): void;
    commitStandalone(gatewayId: string, eventSeq: number): void;
    endTurn(gatewayId: string, completed: boolean): void;
    failed(agent: Agent, message: UserMessage): void;
    gateway(agent: Agent, currentId: string | null): BubbleGateway;
    private changed;
    private prune;
}
