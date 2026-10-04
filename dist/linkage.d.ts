import type { ContextStore } from './store.ts';
import type { RecentMessage } from './llm-router.ts';
import type { StoredContext } from './types.ts';
/** How far topics share context: not at all, within an automatic topic workspace, or by learned relatedness. */
export type LinkScope = 'off' | 'workspace' | 'auto';
export type LinkReason = 'manual' | 'workspace' | 'project' | 'entities' | 'learned' | 'request';
export interface RelatedTopic {
    id: string;
    title: string;
    score: number;
    reasons: LinkReason[];
}
/** Learning signals, in units of relatedness. A pair counts as related from 0.6. */
export declare const LINK_SIGNAL: {
    readonly mention: 0.5;
    readonly switch: 0.2;
    readonly lookup: 0.4;
    readonly unused: -0.05;
};
/**
 * Topics related to `contextId` under `scope`, strongest first. Private topics never share, and a
 * pair the user kept apart never relates. Relatedness starts from structure (same workspace, same
 * project directory, shared entities) and grows with use; the user's links always count.
 */
export declare function relatedTopics(store: ContextStore, contextId: string, scope: LinkScope, limit?: number, now?: number): RelatedTopic[];
/**
 * Whether `source` may share with `reader` right now, read from current settings every time: never
 * when linking is off, a private topic, or a pair the user kept apart; within the same workspace only
 * (unless linked by hand) in workspace scope. Undefined means allowed; otherwise the reason.
 */
export declare function mayShare(store: ContextStore, scope: LinkScope, source: string, reader: string): 'off' | 'unknown' | 'private' | 'workspace' | undefined;
/** When a topic last changed in a way another topic should hear about. */
export declare function lastChange(store: ContextStore, contextId: string): number;
/**
 * What a topic currently knows: its latest compaction summary (dated, since it covers only up to the
 * compaction), the progress recorded after it, and its standing constraints, kept separately because
 * summaries tend to drop rules. Short topics without a compaction fall back to their catalog summary.
 */
export declare function topicDigest(store: ContextStore, context: StoredContext, summaryChars: number, updates?: number): string[];
export interface Briefing {
    text: string;
    shown: string[];
}
/**
 * The cross-topic reference a Worker receives when it starts: the recent main chat after a topic
 * switch (so "what we just said" carries over), its own constraints, and related topics' changes
 * since it last heard of them. Everything is marked as dated reference material, not instructions.
 */
export declare function buildBriefing(store: ContextStore, input: {
    context: StoredContext;
    related: RelatedTopic[];
    recent: RecentMessage[];
    now?: number;
    budget?: number;
    /** Changes to facts this topic used before, and confirmed facts this request uses (shared facts only). */
    notices?: string[];
    facts?: string[];
}): Briefing | undefined;
