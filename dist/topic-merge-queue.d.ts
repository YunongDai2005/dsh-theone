import type { BubbleMerge } from './bubble-types.ts';
interface MergeHooks {
    validate(sourceId: string, targetId: string): void;
    busy(): boolean;
    execute(operation: BubbleMerge, eligible: () => boolean): Promise<void>;
    committed(operation: BubbleMerge): boolean;
    changed(operation: BubbleMerge): void;
}
/** Explicit user commands only. Reads never drain, expire or persist the queue. */
export declare class TopicMergeQueue {
    private readonly hooks;
    private readonly now;
    private readonly ttlMs;
    private readonly db;
    private readonly operations;
    private readonly tasks;
    private timer?;
    private closed;
    constructor(path: string, hooks: MergeHooks, now?: () => number, ttlMs?: number);
    start(): void;
    active(): BubbleMerge[];
    conflicts(sourceId: string, targetId: string, except?: string): boolean;
    request(sourceId: string, targetId: string, requestId: string, whenIdle: boolean): Promise<BubbleMerge>;
    cancel(operationId: string): BubbleMerge;
    drain(): Promise<void>;
    private attempt;
    private execute;
    private change;
    close(): Promise<void>;
}
export {};
