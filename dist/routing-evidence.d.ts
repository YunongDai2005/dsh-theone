import type { Decision } from './types.ts';
/** What a topic has said: its messages, and what its card and catalog entry know. */
export interface TopicMemory {
    id: string;
    texts: readonly string[];
}
/** Details of the message that only this topic has mentioned. Strong: a number, code or name. */
export interface Evidence {
    contextId: string;
    terms: string[];
    strong: boolean;
}
export declare const EVIDENCE_LIMITS: {
    readonly topics: 3;
    readonly terms: 4;
};
/** The details of a message worth looking up, each marked strong (number, code, name) or not. */
export declare function evidenceTerms(text: string): {
    term: string;
    strong: boolean;
}[];
/**
 * Topics holding details of `text` that no other topic holds, the most telling first. Only strong
 * details count: in the benchmark, ordinary words one topic happened to use ("目标", "构图") led
 * messages into the wrong topic more often than they helped.
 */
export declare function routingEvidence(text: string, topics: readonly TopicMemory[]): Evidence[];
/**
 * The topic a strong clue points to when the decision went elsewhere (another topic, a new topic,
 * or a question), or undefined. Only one topic may hold strong clues; several cancel out.
 */
export declare function evidenceConflict(decision: Decision, evidence: readonly Evidence[]): string | undefined;
/** Why a decision is asked again: what it was, and the clue it went against, if any. */
export interface Recheck {
    previous: string;
    contextId?: string;
    terms?: string[];
}
/**
 * Whether a quick decision deserves a second, thinking look: it goes against a strong clue, or it
 * opens a new topic or asks the user, the decisions a quick look gets wrong most and that cost the
 * most when wrong (a split topic, a needless question). Picking an existing topic in line with the
 * clues stands.
 */
export declare function secondLook(decision: Decision, evidence: readonly Evidence[]): Recheck | undefined;
/** Added to the routing prompt only when evidence is offered. */
export declare const EVIDENCE_PROMPT = "\nevidence\uFF08\u53EF\u80FD\u6CA1\u6709\uFF09\u662F\u7A0B\u5E8F\u5728\u5404\u8BDD\u9898\u5DF2\u6709\u7684\u6D88\u606F\u548C\u5361\u7247\u91CC\u67E5\u5230\u7684\uFF1A\u672C\u8F6E text \u63D0\u5230\u7684\u6570\u5B57\u3001\u7F16\u53F7\u3001\u540D\u5B57\u4E2D\uFF0C\u53EA\u6709\u8FD9\u4E2A\u8BDD\u9898\u51FA\u73B0\u8FC7\u7684\u90A3\u4E9B\u3002\u5B83\u662F\u7EBF\u7D22\uFF0C\u4E0D\u662F\u7ED3\u8BBA\uFF1A\u7EC6\u8282\u53EF\u80FD\u53EA\u662F\u78B0\u5DE7\u76F8\u540C\uFF0C\u4E5F\u53EF\u80FD\u662F\u65B0\u4E8B\u60C5\u7B2C\u4E00\u6B21\u63D0\u5230\uFF1B\u7ED3\u5408\u6574\u53E5\u610F\u601D\u5224\u65AD\u3002";
/** Added when a quick decision is asked again, with thinking on. */
export declare const RECHECK_PROMPT = "\nrecheck \u8868\u793A\u8FD9\u662F\u7B2C\u4E8C\u6B21\u5224\u65AD\uFF1A\u4E0A\u4E00\u6B21\u5FEB\u901F\u5224\u65AD\u7684\u7ED3\u8BBA\u662F recheck.previous\uFF08\u5DF2\u6709\u8BDD\u9898\u7684 ID\uFF0C\u6216 CREATE / CLARIFY\uFF09\u3002\u5982\u679C\u6709 recheck.contextId\uFF0C\u662F\u56E0\u4E3A text \u91CC\u7684 recheck.terms \u53EA\u5728\u8BDD\u9898 recheck.contextId \u91CC\u51FA\u73B0\u8FC7\uFF0C\u548C\u4E0A\u6B21\u7684\u7ED3\u8BBA\u4E0D\u4E00\u81F4\u3002\u8FD9\u6B21\u9010\u4E2A\u6BD4\u8F83\u76EE\u5F55\u91CC\u7684\u8BDD\u9898\u518D\u4E0B\u7ED3\u8BBA\uFF1A\u540C\u4E00\u4EF6\u4E8B\u7684\u540E\u7EED\u6B65\u9AA4\u3001\u5B50\u4EFB\u52A1\u548C\u7EC6\u8282\u95EE\u9898\u5C5E\u4E8E\u539F\u6765\u7684\u8BDD\u9898\uFF1B\u786E\u5B9E\u662F\u53E6\u4E00\u4EF6\u4E8B\u624D\u65B0\u5EFA\uFF1B\u53EA\u6709\u89C4\u5219\u5141\u8BB8\u65F6\u624D\u6F84\u6E05\u3002\u7ED3\u8BBA\u53EF\u4EE5\u548C\u4E0A\u6B21\u76F8\u540C\u3002";
