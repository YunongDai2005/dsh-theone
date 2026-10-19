import type { ContextDescriptor, Decision } from './types.ts';
/** Keep credentials out of classifier payloads and automatically generated titles. */
export declare function redactRoutingText(text: string): string;
/** Routing needs old conversation state only for an actual backward reference.
 * Missing factual knowledge (including an unfamiliar name) is the Worker's job.
 */
export declare function referencesHistory(text: string): boolean;
/**
 * TheOne does not ask the user where a message belongs. An unclear decision settles on the topic the
 * classifier leaned to (the current one when it is among the candidates), with the other candidates
 * along as reference; with no candidate it stays in the current topic, or starts a new one. Only a
 * missing model and an unclear "wrong topic" (a correction the user started) still ask.
 */
export declare function settleUnclear(decision: Decision, text: string, contexts: readonly ContextDescriptor[], currentId?: string): Decision;
export declare function newIndependentTopic(text: string, contexts: ContextDescriptor[], reason: string): Decision;
/** A bare acknowledgement or "go on" can only continue the mounted topic, so it needs no classifier call. */
export declare function continuesCurrent(text: string): boolean;
/**
 * "Wrong topic" said right after a reply: the previous message belonged elsewhere. Returns what
 * follows the phrase (often the right topic, e.g. "分错了，是论文的"), or undefined.
 */
export declare function spokenCorrection(text: string): string | undefined;
/** A few distinctive terms of a message, used to teach a topic what belongs to it. */
export declare function topicTerms(text: string, limit?: number): string[];
/** Word and character-pair features of a short message, for cheap similarity without a model call. */
export declare function textFeatures(text: string): Set<string>;
/** Overlap of two feature sets, 0 (nothing shared) to 1 (identical). */
export declare function similarity(a: Set<string>, b: Set<string>): number;
