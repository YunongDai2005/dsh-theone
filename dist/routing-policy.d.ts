import type { ContextDescriptor, Decision } from './types.ts';
/** Keep credentials out of classifier payloads and automatically generated titles. */
export declare function redactRoutingText(text: string): string;
/** Routing needs old conversation state only for an actual backward reference.
 * Missing factual knowledge (including an unfamiliar name) is the Worker's job.
 */
export declare function referencesHistory(text: string): boolean;
export declare function newIndependentTopic(text: string, contexts: ContextDescriptor[], reason: string): Decision;
/** A bare acknowledgement or "go on" can only continue the mounted topic, so it needs no classifier call. */
export declare function continuesCurrent(text: string): boolean;
