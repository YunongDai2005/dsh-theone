export type WorkState = 'queued' | 'running' | 'paused' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export interface WorkInput {
    key: string;
    kind: string;
    resource: string;
    payload: unknown;
}
export interface WorkJob extends WorkInput {
    id: string;
    state: WorkState;
    due: number;
    created: number;
    runs: number;
    failures: number;
    token?: string;
    leaseUntil?: number;
    candidate?: unknown;
    result?: unknown;
    error?: string;
}
export interface WorkNotice {
    id: string;
    jobId: string;
    text: string;
    at: number;
}
/** Durable work is kept separate from the user's DSH session log. */
export declare class WorkStore {
    private readonly db;
    constructor(path: string);
    enqueue(input: WorkInput, now?: number): WorkJob;
    list(): WorkJob[];
    get(id: string): WorkJob | undefined;
    private transaction;
    claim(now?: number, leaseMs?: number, exclude?: string[]): WorkJob | undefined;
    owns(job: WorkJob, now?: number): boolean;
    checkpoint(job: WorkJob, candidate: unknown, now?: number): boolean;
    finish(job: WorkJob, result: unknown, nextAt?: number, notice?: {
        fingerprint: string;
        text: string;
    }, now?: number): boolean;
    control(id: string, action: 'pause' | 'resume' | 'cancel' | 'wake', now?: number): boolean;
    wake(id: string, eventId: string, now?: number): boolean;
    fail(job: WorkJob, error: string, now?: number): void;
    wait(job: WorkJob, reason: string, now?: number): void;
    release(job: WorkJob, now?: number): void;
    pendingNotices(): WorkNotice[];
    delivered(id: string): void;
    attention(job: WorkJob, text: string, now?: number): void;
    close(): void;
}
