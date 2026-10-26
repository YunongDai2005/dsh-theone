import { WorkStore, type WorkJob, type WorkNotice } from './work-store.ts';
import { WorkScheduler, type WorkScope, type WorkOutcome } from './work-scheduler.ts';
import { type PullSnapshot } from './research.ts';
export interface ResearchTask {
    objective: string;
    url: string;
    gatewayId: string;
    sessionId: string;
    contextId?: string;
    completion: 'closed' | 'checks-passed';
    intervalMs: number;
    deadline: number;
    maxChecks: number;
}
export interface WorkHost {
    /** Off: PR checks wait (TASKS_OFF) and pick up again once turned back on. */
    enabled?(): boolean;
    available?(task: ResearchTask): boolean;
    analyze(task: ResearchTask, snapshot: PullSnapshot, signal: AbortSignal): Promise<unknown>;
    memory(job: WorkJob, scope: WorkScope): Promise<WorkOutcome>;
    notify(notice: WorkNotice, job: WorkJob): Promise<boolean>;
}
export declare class PersistentWork {
    private readonly host;
    private readonly fetcher;
    private readonly now;
    readonly store: WorkStore;
    readonly scheduler: WorkScheduler;
    private timer?;
    private notifying?;
    private stopped;
    constructor(path: string, host: WorkHost, fetcher?: typeof fetch, now?: () => number);
    create(input: Record<string, unknown>, origin: {
        key: string;
        gatewayId: string;
        sessionId: string;
        contextId?: string;
    }): WorkJob;
    private run;
    start(): void;
    tick(): Promise<void>;
    private deliver;
    close(): Promise<void>;
}
