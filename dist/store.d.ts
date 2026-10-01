import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { ExtractedTopic, HistoryPart, TopicGroup } from './catalog-types.ts';
import type { ContextDescriptor, Decision, RouteRecord, StoredContext, SourceRange } from './types.ts';
/** Stores descriptors and routing metadata. Original conversation stays in DSH. */
export declare class ContextStore {
    private readonly db;
    constructor(path: string);
    /** Only model identity is persisted. API credentials remain owned by DSH. */
    rememberModel(gatewayKey: string, selection: ModelSelection): void;
    rememberedModel(gatewayKey: string): ModelSelection | undefined;
    seed(contexts: ContextDescriptor[]): void;
    contexts(): StoredContext[];
    current(gatewayKey: string): string | undefined;
    groups(): TopicGroup[];
    isGateway(sessionId: string): boolean;
    rememberGateway(gatewayKey: string, sessionId: string): void;
    origin(contextId: string): {
        sessionId: string;
        cwd?: string;
    } | undefined;
    indexState(sessionId: string): {
        throughSeq: number;
        status: string;
    } | undefined;
    markIndex(sessionId: string, throughSeq: number, status: 'ready' | 'failed' | 'skipped', errorCode?: string): void;
    indexedTurn(sessionId: string, seq: number): {
        fingerprint: string;
        contextId: string;
    } | undefined;
    /** One validated batch commits descriptors, groups and exact source ranges atomically. */
    importTopics(sessionId: string, cwd: string | undefined, parts: HistoryPart[], topics: ExtractedTopic[]): void;
    mount(gatewayKey: string, contextId: string): void;
    contextsForSessions(sessionIds: string[]): string[];
    /** Model-maintained progress is bounded and auditable; stable project identity remains unchanged. */
    updateState(contextId: string, state: string, sessionId: string, throughSeq: number): void;
    stateUpdates(contextId: string): Record<string, import("node:sqlite").SQLOutputValue>[];
    /** Reuse a completed DSH compaction checkpoint once, without another model call. */
    updateSummary(contextId: string, summary: string, sessionId: string, summarySeq: number, endSeq: number): void;
    summaryUpdates(contextId: string): Record<string, import("node:sqlite").SQLOutputValue>[];
    route(messageId: string): RouteRecord | undefined;
    recentGatewayIds(gatewayKey: string, excludingId: string): string[];
    /** Idempotent planning reserves a worker ID before any DSH creation. */
    plan(messageId: string, gatewayId: string, gatewayKey: string, proposed: Decision): RouteRecord;
    /** Only a planned route may execute. Ambiguous interrupted work is never replayed automatically. */
    claim(messageId: string): void;
    finish(messageId: string, status: 'completed' | 'failed'): void;
    /** Whole-session access is allowed only for this Context's dedicated worker. */
    addSource(contextId: string, sessionId: string, range?: {
        startSeq: number;
        endSeq: number;
    }): void;
    /** Old unscoped historical mappings remain visible, but cannot be searched. */
    sourceRanges(contextId: string): SourceRange[];
    sources(contextId: string): string[];
    close(): void;
}
