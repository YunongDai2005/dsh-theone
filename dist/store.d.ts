import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { ExtractedTopic, HiddenReason, HistoryPart, TopicGroup } from './catalog-types.ts';
import type { ContextDescriptor, ContextUsage, Decision, RouteRecord, RouteView, StoredContext, SourceRange, TopicLink } from './types.ts';
import { type FactEvidence, type FactKind, type FactView } from './facts.ts';
/** A write to a topic's facts, after its evidence was checked against the session. */
export interface FactWrite {
    factId?: string;
    label: string;
    kind: FactKind;
    value: string;
    aliases?: string[];
    status: 'confirmed' | 'proposed';
    evidence: FactEvidence;
    origin: FactView['origin'];
    /** The version the writer last saw; the write is refused if the fact has moved on since. */
    expectedVersion?: number;
}
export type FactOutcome = 'created' | 'updated' | 'unchanged' | 'retracted' | 'rejected';
export interface FactResult {
    outcome: FactOutcome;
    /** Why a write was refused: stale (the fact changed since `expectedVersion`), older-evidence,
     * keeps-confirmed (a proposal never replaces a confirmed value), unknown-fact, invalid. */
    reason?: string;
    fact?: FactView;
    previous?: FactView;
}
/** Terms learned from corrections fade by half every 30 days unless they are confirmed again. */
export declare const TERM_HALF_LIFE_MS: number;
/** A whole session attached by hand counts as reviewed from its first event to its last. */
export declare const WHOLE_SESSION: {
    startSeq: number;
    endSeq: number;
};
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
    /** Every completed route of this entry, oldest first, to the topic it really belonged to (after corrections). */
    routeTimeline(gatewayKey: string): {
        contextId: string;
        at: number;
    }[];
    /**
     * A topic's routing card: other names and entities join its keywords, and its summary is replaced
     * unless a compaction summary (written from the whole session) already took its place.
     */
    applyCard(contextId: string, card: {
        summary: string;
        aliases: string[];
        entities: string[];
        open: string[];
    }): void;
    groups(): TopicGroup[];
    isGateway(sessionId: string): boolean;
    /** Record the fixed "TheOne · Main chat" entry; other sessions may also use TheOne and switch away. */
    rememberGateway(gatewayKey: string, sessionId: string): void;
    /**
     * Sessions TheOne made for itself: every fixed main chat and each topic's background session.
     * Sessions the user made, including ones that once chose TheOne as their model, are not among them.
     */
    ownedSessionIds(): string[];
    /** TheOne's own sessions it put in DSH's archive when it stopped; only these are taken out again. */
    stowedSessionIds(): string[];
    markStowed(sessionId: string, stowed: boolean, now?: number): void;
    isPinnedGateway(sessionId: string): boolean;
    origin(contextId: string): {
        sessionId: string;
        cwd?: string;
    } | undefined;
    indexState(sessionId: string): {
        throughSeq: number;
        status: string;
    } | undefined;
    markIndex(sessionId: string, throughSeq: number, status: 'ready' | 'failed' | 'skipped' | 'excluded', errorCode?: string): void;
    /** A turn of a topic the user deleted; the catalog must not extract it again while it is unchanged. */
    dismissedTurn(sessionId: string, seq: number): string | undefined;
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
    /** The main chat used last (by its latest routed message), else the newest one; shared by every browser. */
    latestGateway(gatewayKey: string): string | undefined;
    recentGatewayIds(gatewayKey: string, excludingId: string): string[];
    /**
     * Idempotent planning reserves a worker ID before any DSH creation. A message planned while another
     * reply runs (`mount` false) leaves the topic in use as it is until main chat gets to it.
     */
    plan(messageId: string, gatewayId: string, gatewayKey: string, proposed: Decision, mount?: boolean): RouteRecord;
    /** Only a planned route may execute. Ambiguous interrupted work is never replayed automatically. */
    claim(messageId: string): void;
    /** Drop the route of a message main chat never got to (the user deleted it from the queue). */
    forget(messageId: string): void;
    finish(messageId: string, status: 'completed' | 'failed'): void;
    /** Whole-session access is allowed only for this Context's dedicated worker. */
    addSource(contextId: string, sessionId: string, range?: {
        startSeq: number;
        endSeq: number;
    }): void;
    /** Old unscoped historical mappings remain visible, but cannot be searched. */
    sourceRanges(contextId: string): SourceRange[];
    sources(contextId: string): string[];
    /** What a route was decided from: a short redacted excerpt and the classifier's receipt. */
    recordRouteDetail(messageId: string, excerpt: string, receipt: unknown): void;
    /** This entry's latest routes, newest first. */
    recentRoutes(gatewayKey: string, limit?: number): RouteView[];
    /** Record that a message belonged to another topic; later routing learns from it. */
    correctRoute(messageId: string, contextId: string, now?: number): void;
    /**
     * Terms a correction showed belong to a topic (positive delta) or not (negative). Weights fade
     * over time, stay within 0–5, and a term that falls to nothing is forgotten.
     */
    learnTerms(contextId: string, terms: string[], delta: number, now?: number): void;
    /** Each topic's learned terms that still count (weight > 0.5 after fading), strongest first. */
    learnedTerms(now?: number, limit?: number): Map<string, string[]>;
    /** How routing has gone lately: of the last `limit` messages, how many were moved, asked about or routed by rules after a failure. */
    routeStats(gatewayKey: string, limit?: number): {
        total: number;
        corrected: number;
        clarified: number;
        fallback: number;
    };
    /** Corrections as examples for the classifier: this text belonged there, not here. Newest first. */
    corrections(gatewayKey: string, limit?: number): {
        text: string;
        wrongId?: string;
        rightId: string;
    }[];
    private writeDescriptor;
    private context;
    /** Terms a correction showed belong to this topic, newest kept first. */
    addKeywords(contextId: string, terms: string[]): void;
    /** The user's own wording for a topic outranks what the catalog extracted. */
    editTopic(contextId: string, change: {
        title?: string;
        summary?: string;
        lastState?: string;
    }): void;
    createTopic(title: string, summary?: string): string;
    /**
     * A branch of a topic: a new topic with the same descriptor, constraints, privacy, workspace and
     * folder, whose work continues in `workingSessionId` (a fork of the topic's session).
     */
    branchTopic(sourceId: string, title: string, workingSessionId: string, cwd?: string): string;
    /** Put a topic in another topic workspace, or a new one named `title`; null leaves it unassigned. */
    moveTopic(contextId: string, target: {
        groupId: string;
    } | {
        title: string;
    } | null): void;
    /** Attach a whole existing session to a topic as reviewed history its Worker may search. */
    attachSession(contextId: string, sessionId: string): void;
    /**
     * Fold `sourceId` into `targetId`: its history, progress, summaries and links move over, and its
     * own Worker session becomes searchable history of the target. The source topic is removed.
     */
    mergeTopics(sourceId: string, targetId: string): void;
    /** Remove a topic and everything TheOne kept about it. DSH keeps the conversations themselves. */
    deleteTopic(contextId: string): void;
    private purge;
    private factQuery;
    private factFrom;
    /** A fact's current state, also when its topic was deleted (then it has no value). */
    fact(factId: string): (FactView & {
        lastUsedAt?: number;
    }) | undefined;
    /** One earlier version of a fact. */
    factVersion(factId: string, version: number): FactView | undefined;
    /** A topic's live facts; include withdrawn identities when taking a write/extraction baseline. */
    facts(contextId: string, includeRetracted?: boolean): FactView[];
    /** Confirmed facts of every other live topic, the pool other topics may draw from. */
    sharedFacts(excludeContextId?: string): (FactView & {
        lastUsedAt?: number;
    })[];
    private factByName;
    /** Refuse a write that is older than what the fact already holds. */
    private staleWrite;
    private newerEvidence;
    private inTransaction;
    private addVersion;
    /**
     * Record a fact or a new value of it. Same fact means the given id, or the same folded name or alias
     * within the topic; names are never matched loosely. The write is refused when it is stale, when its
     * evidence is older than the current version's, or when a proposal would replace a confirmed value.
     */
    recordFact(contextId: string, write: FactWrite, now?: number): FactResult;
    /** The user said a fact no longer holds (or is not decided yet): a new version without a value. */
    retractFact(contextId: string, factId: string, evidence: FactEvidence, origin: FactView['origin'], expectedVersion?: number, now?: number): FactResult;
    /** A fact reached a topic (by routing, a lookup or a change notice): log it and note the version seen. */
    recordDelivery(contextId: string, fact: Pick<FactView, 'id' | 'version'>, via: 'route' | 'lookup' | 'notice', inputId?: string, now?: number): void;
    /** The facts a topic has been given, with the version it last saw. */
    dependencies(contextId: string): {
        factId: string;
        versionSeen: number;
    }[];
    forgetDependency(contextId: string, factId: string): void;
    /** Delivery log of a topic, oldest first. */
    deliveries(contextId: string): {
        factId: string;
        version: number;
        via: string;
        inputId?: string;
    }[];
    /**
     * Facts of a merged topic move with their identity, so whoever depends on them keeps doing so. A name
     * both topics use stays two facts: the incoming one is renamed after its topic; values never merge.
     */
    private mergeFacts;
    /**
     * A deleted topic's facts lose their values and evidence; the identity stays as a tombstone so that
     * topics which used them can be told once that they are gone. What the topic itself received goes.
     */
    private purgeFacts;
    /** A changed-files card in main chat (`gatewayId`, `seq`) reads the topic's record (`sessionId`, `seq`). */
    linkChange(gatewayId: string, seq: number, source: {
        sessionId: string;
        seq: number;
        turn: number;
    }): void;
    changeLink(gatewayId: string, seq: number): {
        sessionId: string;
        seq: number;
        turn: number;
    } | undefined;
    /** Notices the user closed; they are not shown again on any browser. */
    dismissNotice(id: string, now?: number): void;
    /** True the first time `name` is marked, false ever after: for one-time repairs. */
    markOnce(name: string, now?: number): boolean;
    dismissedNotices(): Set<string>;
    /**
     * Topics kept in the directory but hidden from routing and briefings: every conversation they can
     * draw on is gone from disk (`orphaned`) or archived in DSH (`archived`). The catalog scan
     * recomputes this set, so restoring a conversation or unarchiving it brings the topic back.
     */
    hiddenReasons(): Map<string, HiddenReason>;
    /** Replace the hidden set in one write, so a scan never leaves a stale entry behind. */
    replaceHidden(entries: readonly {
        id: string;
        reason: string;
    }[], now?: number): void;
    close(): void;
}
