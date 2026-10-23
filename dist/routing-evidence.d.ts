import type { Decision } from './types.ts';
/** What a topic has said: its messages, and what its card and catalog entry know. */
export interface TopicMemory {
    id: string;
    texts: readonly string[];
}
/** Numbers, codes and names of the message that only this topic has mentioned. */
export interface Evidence {
    contextId: string;
    terms: string[];
}
export declare const EVIDENCE_LIMITS: {
    readonly topics: 3;
    readonly terms: 4;
};
/** The details of a message worth looking up: numbers of three or more digits, codes, and names. */
export declare function evidenceTerms(text: string): string[];
/** Topics holding details of `text` that no other topic holds, the most telling first. */
export declare function routingEvidence(text: string, topics: readonly TopicMemory[]): Evidence[];
/**
 * The topic a clue points to when the decision went elsewhere (another topic, a new topic, or a
 * question), or undefined. Only one topic may hold clues; several cancel out.
 */
export declare function evidenceConflict(decision: Decision, evidence: readonly Evidence[]): string | undefined;
/** Why a decision is asked again: what it was, and the clue it went against, if any. */
export interface Recheck {
    previous: string;
    contextId?: string;
    terms?: string[];
}
/**
 * Whether a quick decision deserves a second, thinking look: it goes against a clue, or it opens a
 * new topic or asks the user, the decisions a quick look gets wrong most and that cost the most when
 * wrong (a split topic, a needless question). Picking an existing topic in line with the clues stands.
 */
export declare function secondLook(decision: Decision, evidence: readonly Evidence[]): Recheck | undefined;
/** Added when a quick decision is asked again, with thinking on. */
export declare const RECHECK_PROMPT = "\nrecheck \u8868\u793A\u8FD9\u662F\u7B2C\u4E8C\u6B21\u5224\u65AD\uFF1A\u4E0A\u4E00\u6B21\u5FEB\u901F\u5224\u65AD\u7684\u7ED3\u8BBA\u662F recheck.previous\uFF08\u5DF2\u6709\u8BDD\u9898\u7684 ID\uFF0C\u6216 CREATE / CLARIFY\uFF09\u3002\u5982\u679C\u6709 recheck.contextId\uFF0C\u662F\u56E0\u4E3A text \u91CC\u7684 recheck.terms \u53EA\u5728\u8BDD\u9898 recheck.contextId \u91CC\u51FA\u73B0\u8FC7\uFF0C\u548C\u4E0A\u6B21\u7684\u7ED3\u8BBA\u4E0D\u4E00\u81F4\u3002\u8FD9\u6B21\u9010\u4E2A\u6BD4\u8F83\u76EE\u5F55\u91CC\u7684\u8BDD\u9898\u518D\u4E0B\u7ED3\u8BBA\uFF1A\u540C\u4E00\u4EF6\u4E8B\u7684\u540E\u7EED\u6B65\u9AA4\u3001\u5B50\u4EFB\u52A1\u548C\u7EC6\u8282\u95EE\u9898\u5C5E\u4E8E\u539F\u6765\u7684\u8BDD\u9898\uFF1B\u786E\u5B9E\u662F\u53E6\u4E00\u4EF6\u4E8B\u624D\u65B0\u5EFA\uFF1B\u53EA\u6709\u89C4\u5219\u5141\u8BB8\u65F6\u624D\u6F84\u6E05\u3002\u7ED3\u8BBA\u53EF\u4EE5\u548C\u4E0A\u6B21\u76F8\u540C\u3002";
