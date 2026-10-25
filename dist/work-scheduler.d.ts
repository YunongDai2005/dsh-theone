import { WorkStore, type WorkJob } from './work-store.ts';
export interface WorkOutcome {
    result?: unknown;
    nextAt?: number;
    waiting?: string;
    notice?: {
        fingerprint: string;
        text: string;
    };
}
export interface WorkScope {
    signal: AbortSignal;
    checkpoint(value: unknown): boolean;
    owns(): boolean;
}
export type WorkHandler = (job: WorkJob, scope: WorkScope) => Promise<WorkOutcome>;
export declare class WorkScheduler {
    readonly store: WorkStore;
    private readonly handler;
    private readonly now;
    private stopped;
    private timer?;
    private pump?;
    private active?;
    constructor(store: WorkStore, handler: WorkHandler, now?: () => number);
    start(): void;
    tick(): Promise<void>;
    private drain;
    control(id: string, action: 'pause' | 'resume' | 'cancel' | 'wake'): boolean;
    stop(): Promise<void>;
}
