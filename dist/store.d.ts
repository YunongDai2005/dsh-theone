import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { ExtractedTopic, HistoryPart, TopicGroup } from './catalog-types.ts';
import type { ContextDescriptor, ContextUsage, Decision, RouteRecord, StoredContext, SourceRange, TopicLink } from './types.ts';
/** Stores descriptors and routing metadata. Original conversation stays in DSH. */
export declare class ContextStore {
    private readonly db;
    constructor(path: string);
    settings(gatewayKey: string): {
        values: unknown;
        revision: number;
    } | undefined;
    saveSettings(gatewayKey: string, values: unknown, revision: number): boolean;
    /** Only model identity is persisted. API credentials remain owned by DSH. */
    rememberModel(gatewayKey: string, selection: ModelSelection): void;
    rememberedModel(gatewayKey: string): ModelSelection | undefined;
    seed(contexts: ContextDescriptor[]): void;
    contexts(): StoredContext[];
    /** Context ids, newest first. contexts() is ordered by id, and generated ids are random. */
    contextIdsByRecency(): string[];
    current(gatewayKey: string): string | undefined;
    /** Successful uses only: retries, failed work and clarification never heat a topic. */
    contextUsage(gatewayKey: string, now?: number): ContextUsage[];
    groups(): TopicGroup[];
    isGateway(sessionId: string): boolean;
    /** Record the fixed "TheOne · Main chat" entry; other sessions may also use TheOne and switch away. */
    rememberGateway(gatewayKey: string, sessionId: string): void;
    isPinnedGateway(sessionId: string): boolean;
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
    /** Learned relatedness halves every two weeks without new evidence. */
    static readonly LINK_HALF_LIFE_MS: number;
    private pair;
    /** Link rows touching one topic (or all), with learned weight decayed to `now`. */
    links(contextId?: string, now?: number): TopicLink[];
    /** Add learned evidence; a pair the user unlinked never learns back. */
    learnLink(a: string, b: string, delta: number, now?: number): void;
    /** 1 links a pair permanently, -1 keeps it apart, 0 returns it to learning. */
    setManualLink(a: string, b: string, manual: TopicLink['manual'], now?: number): void;
    /** Forget learned relatedness; the user's own links and separations stay. */
    clearLearnedLinks(): void;
    setPrivate(contextId: string, value: boolean): void;
    privateIds(): Set<string>;
    /** Project directory of every topic that came from an existing session. */
    origins(): Map<string, string | undefined>;
    isPrivate(contextId: string): boolean;
    /** Standing rules for a topic, kept apart from summaries so compaction cannot drop them. */
    setConstraints(contextId: string, text: string | null, now?: number): void;
    constraints(contextId: string): {
        text: string;
        at: number;
    } | undefined;
    /** The latest full compaction summary of a topic's Worker and how far it covers. */
    saveDigest(contextId: string, summary: string, throughSeq: number, now?: number): void;
    digest(contextId: string): {
        summary: string;
        throughSeq: number;
        at: number;
    } | undefined;
    /** When `reader` last received `source`'s state in a briefing. */
    seen(reader: string, source: string): number | undefined;
    markSeen(reader: string, source: string, at: number): void;
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
