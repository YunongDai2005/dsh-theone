import { DatabaseSync } from 'node:sqlite';
/** Ownership is a revisable inference, never a confirmation inferred from silence. */
export interface LearningSource {
    messageId: string;
    contextId: string;
    revision: number;
}
export type LearningStage = 'proposed' | 'inferred' | 'confirmed' | 'excluded';
export declare const uniqueSources: (sources: readonly LearningSource[]) => LearningSource[];
/** A small event journal for local, reversible projections. It never replays a Worker or a tool. */
export declare class LearningJournal {
    private db;
    private snapshot;
    private restore;
    private execute;
    replaying: boolean;
    private current;
    private statements;
    private stages;
    private version;
    private checked;
    constructor(db: DatabaseSync, snapshot: (stream: string) => unknown, restore: (stream: string, snapshot: unknown) => void, execute: (kind: string, args: unknown[]) => unknown);
    private sql;
    source(messageId: string, contextId: string): LearningSource;
    forget(): void;
    private fresh;
    stage(source: LearningSource): LearningStage | undefined;
    valid(sources: readonly LearningSource[]): boolean;
    settle(messageId: string, contextId: string, confirmed?: boolean): void;
    move(messageId: string, contextId: string): void;
    bind(sessionId: string, inputId: string, messageId: string, contextId: string, startSeq: number, parents?: LearningSource[]): void;
    depend(sessionId: string, messageId: string, sources: LearningSource[]): void;
    excludedMessage(messageId: string): boolean;
    end(sessionId: string, inputId: string, endSeq: number): void;
    turns(sessionId: string): {
        inputId: string;
        sources: LearningSource[];
        source: LearningSource;
        startSeq: number;
        endSeq: number;
    }[];
    sources(sessionId: string, throughSeq: number, fromSeq?: number): LearningSource[];
    using<T>(sources: readonly LearningSource[], work: () => T): T;
    get activeSources(): LearningSource[];
    dependencies(stream: string): LearningSource[];
    record<T>(stream: string, kind: string, args: unknown[], work: () => T, refused: T): T;
    /** Invalidation and replay share the caller's correction transaction. */
    rebuild(streams?: readonly string[]): void;
    private project;
    audit(): {
        id: number;
        stream: string;
        kind: string;
        sources: LearningSource[];
        active: boolean;
        pending: boolean;
    }[];
}
