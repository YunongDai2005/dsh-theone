import type { SessionEvent } from '@deepseek-ai/dsh-session';
export type FactKind = 'fact' | 'decision' | 'artifact';
export type FactStatus = 'confirmed' | 'proposed' | 'retracted';
export type Speaker = 'user' | 'assistant' | 'tool';
export declare const FACT_KINDS: readonly FactKind[];
/** Where a version came from. `seq` is null when the quoted words were not found in the session. */
export interface FactEvidence {
    sessionId: string;
    seq: number | null;
    speaker: Speaker | 'unverified';
    quote: string;
    /** For a confirmation such as "ok, go with that": the assistant's proposal it accepted. */
    accepts?: {
        seq: number;
        quote: string;
    };
}
/** A fact as it stands now: its identity and its current version. */
export interface FactView {
    id: string;
    contextId: string;
    key: string;
    label: string;
    aliases: string[];
    kind: FactKind;
    version: number;
    status: FactStatus;
    value: string | null;
    evidence: FactEvidence;
    origin: 'worker' | 'extractor';
    createdAt: number;
    deletedAt?: number;
    mergedFrom?: string;
}
/** Every size limit of the feature in one place; each is a hard cap on characters or items. */
export declare const FACT_LIMITS: {
    readonly label: 60;
    readonly value: 300;
    readonly quote: 200;
    readonly aliases: 6;
    readonly alias: 60;
    readonly recordItems: 8;
    readonly routerBudget: 1200;
    readonly routerLabel: 40;
    readonly routerValue: 80;
    readonly routerItems: 12;
    readonly imports: 5;
    readonly briefingBudget: 1200;
    readonly noticeBudget: 600;
    readonly ownBudget: 1500;
    readonly ownItems: 20;
    readonly lookupItems: 10;
    readonly extractionBudget: 6000;
    readonly extractionFacts: 1500;
};
/** Text that may be stored or shown: credentials and personal addresses removed, then shortened. */
export declare const safe: (text: string, max: number) => string;
/**
 * The name two writes must share to be the same fact. Case, width and spacing are folded, and only
 * wrapping quotes and punctuation are dropped, so `C++`, `C#` and `.NET` stay distinct.
 */
export declare function factKey(label: string): string;
/** Folded text for finding a quote inside a message: width, case, spacing and thousands separators. */
export declare function matchText(text: string): string;
/** Does `source` actually state `value`? Literally, by all of its numbers, or by most of its wording. */
export declare function states(source: string, value: string): boolean;
/** "ok, go with that": an explicit acceptance, without a refusal and not itself a question. */
export declare function accepts(text: string): boolean;
export interface EvidenceEvent {
    seq: number;
    speaker: Speaker;
    text: string;
}
/**
 * The messages of a topic session that can serve as evidence, newest last: the user's own messages,
 * the assistant's answers and tool activity. TheOne's reference material for the session (its
 * descriptor, cross-topic briefings) is not the user speaking and never counts.
 */
export declare function evidenceEvents(events: readonly SessionEvent[], limit?: number): EvidenceEvent[];
/** The newest event containing `quote` (folded), optionally only from one speaker or before a point. */
export declare function findQuote(events: readonly EvidenceEvent[], quote: string, options?: {
    speaker?: Speaker;
    before?: number;
}): EvidenceEvent | undefined;
export interface Verdict {
    status: 'confirmed' | 'proposed';
    evidence: FactEvidence;
    reason?: string;
}
/**
 * Decide from the session itself whether a value was confirmed. The model only points at words; the
 * speaker and the position come from the session. Confirmed means: the user stated the value; or the
 * user explicitly accepted an earlier assistant proposal that stated it; or, for an artifact, a tool
 * produced it. Anything else is a proposal and stays inside its topic.
 */
export declare function verify(input: {
    sessionId: string;
    events: readonly EvidenceEvent[];
    kind: FactKind;
    value: string;
    quote: string;
    acceptsQuote?: string;
}): Verdict;
/** One fact as other topics are shown it: `【topic】label = value (version n, confirmed at …)`. */
export declare function factLine(fact: FactView, topicTitle: string): string;
/** Lines up to a character budget, whole lines only. */
export declare function within(lines: string[], budget: number): string[];
export interface FactCandidate {
    id: string;
    topic: string;
    label: string;
    kind: FactKind;
    value: string;
}
/**
 * Facts from other topics that the message may draw on, best first. Ranking only: whether a fact may
 * actually be delivered is decided again at delivery, against the final topic and current settings.
 */
export declare function rankCandidates(facts: readonly (FactView & {
    topicTitle: string;
    related: number;
    lastUsedAt?: number;
})[], text: string, now?: number): FactCandidate[];
