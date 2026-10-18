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
/** Topics holding details of `text` that no other topic holds, the most telling first. */
export declare function routingEvidence(text: string, topics: readonly TopicMemory[]): Evidence[];
/**
 * The topic a strong clue points to when the decision went elsewhere (another topic, a new topic,
 * or a question), or undefined. Only one topic may hold strong clues; several cancel out.
 */
export declare function evidenceConflict(decision: Decision, evidence: readonly Evidence[]): string | undefined;
/** Added to the routing prompt only when evidence is offered. */
export declare const EVIDENCE_PROMPT = "\nevidence\uFF08\u53EF\u80FD\u6CA1\u6709\uFF09\u662F\u7A0B\u5E8F\u5728\u5404\u8BDD\u9898\u5DF2\u6709\u7684\u6D88\u606F\u548C\u5361\u7247\u91CC\u67E5\u5230\u7684\uFF1A\u672C\u8F6E text \u63D0\u5230\u7684\u7EC6\u8282\uFF08\u6570\u5B57\u3001\u7F16\u53F7\u3001\u540D\u5B57\u3001\u5C11\u89C1\u7684\u8BCD\uFF09\u4E2D\uFF0C\u53EA\u6709\u8FD9\u4E2A\u8BDD\u9898\u51FA\u73B0\u8FC7\u7684\u90A3\u4E9B\u3002strong \u4E3A true \u8868\u793A\u5176\u4E2D\u6709\u6570\u5B57\u3001\u7F16\u53F7\u6216\u540D\u5B57\u3002\u5B83\u662F\u7EBF\u7D22\uFF0C\u4E0D\u662F\u7ED3\u8BBA\uFF1A\u7EC6\u8282\u53EF\u80FD\u53EA\u662F\u78B0\u5DE7\u76F8\u540C\uFF0C\u4E5F\u53EF\u80FD\u662F\u65B0\u4E8B\u60C5\u7B2C\u4E00\u6B21\u63D0\u5230\uFF1B\u7ED3\u5408\u6574\u53E5\u610F\u601D\u5224\u65AD\u3002";
/** Added when a decision went against a strong clue and the classifier is asked again. */
export declare const RECHECK_PROMPT = "\nrecheck \u8868\u793A\u4F60\u4E0A\u4E00\u6B21\u7684\u5224\u65AD\u548C\u7A0B\u5E8F\u627E\u5230\u7684\u7EBF\u7D22\u4E0D\u4E00\u81F4\uFF1A\u4E0A\u6B21\u9009\u4E86 recheck.previous\uFF0C\u4F46 text \u91CC\u7684 recheck.terms \u53EA\u5728\u8BDD\u9898 recheck.contextId \u91CC\u51FA\u73B0\u8FC7\u3002\u91CD\u65B0\u5224\u65AD\u4E00\u6B21\uFF1A\u5982\u679C\u8FD9\u53E5\u8BDD\u786E\u5B9E\u5728\u8BF4\u90A3\u4E2A\u8BDD\u9898\u7684\u4E8B\uFF0C\u5C31\u9009\u5B83\uFF1B\u5982\u679C\u53EA\u662F\u78B0\u5DE7\u63D0\u5230\u76F8\u540C\u7684\u7EC6\u8282\uFF0C\u4FDD\u6301\u539F\u5224\u65AD\u3002";
