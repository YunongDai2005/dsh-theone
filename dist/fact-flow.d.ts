import type { ContextStore } from './store.ts';
import { type LinkScope } from './linkage.ts';
import { type EvidenceEvent, type FactCandidate, type FactView } from './facts.ts';
/** Confirmed facts this message might use, best first, within budget. Ranking only. */
export declare function factCandidates(store: ContextStore, scope: LinkScope, text: string, recent: string[], currentId?: string): FactCandidate[];
export interface FactDelivery {
    notices: string[];
    facts: string[];
    /** Record what was sent; call only once the briefing carrying these lines is actually sent. */
    commit(): void;
}
/**
 * What a topic is told about facts before its Worker answers: changes to facts it used before
 * (also on a plain "go on") and the facts this request imports. Every fact is checked here, against
 * the topic finally chosen and the settings now; nothing is recorded until `commit`.
 */
export declare function factDelivery(store: ContextStore, scope: LinkScope, contextId: string, imports: string[], inputId?: string): FactDelivery;
/** The topic's own recorded facts, with ids and versions, for its Worker's descriptor. */
export declare function ownFactsText(store: ContextStore, contextId: string): string;
/** Optional extraction after a turn; every item it returns is checked like a Worker's own record. */
export declare const EXTRACT_PROMPT = "\u4F60\u5728\u5E2E\u4E00\u4E2A\u8BDD\u9898\u8BB0\u5F55\u5DF2\u7ECF\u786E\u5B9A\u4E0B\u6765\u7684\u8981\u70B9\uFF1A\u6570\u5B57\u3001\u65E5\u671F\u3001\u51B3\u5B9A\u3001\u6587\u4EF6\u6216\u94FE\u63A5\u7684\u4F4D\u7F6E\u3002\u8F93\u5165\u662F\u672C\u8F6E\u7684\u7528\u6237\u6D88\u606F user\u3001\u52A9\u624B\u56DE\u7B54 assistant\uFF0C\u4EE5\u53CA\u672C\u8BDD\u9898\u5DF2\u8BB0\u5F55\u7684\u8981\u70B9 facts\uFF08\u542B factId \u548C\u7248\u672C\uFF09\u3002\n\u53EA\u8BB0\u5F55\u7528\u6237\u4EB2\u53E3\u8BF4\u51FA\u7684\u503C\uFF0C\u6216\u7528\u6237\u660E\u786E\u63A5\u53D7\u4E86\u52A9\u624B\u63D0\u8BAE\u7684\u503C\uFF08\u6B64\u65F6 acceptsQuote \u586B\u52A9\u624B\u63D0\u8BAE\u7684\u539F\u8BDD\uFF09\uFF1B\u52A9\u624B\u81EA\u5DF1\u7684\u5EFA\u8BAE\u3001\u63A8\u6D4B\u3001\u672A\u5B9A\u7684\u4E8B\u4E0D\u8981\u8BB0\u5F55\u3002\n\u6BCF\u6761\u90FD\u5FC5\u987B\u7ED9\u51FA evidenceQuote\uFF1A\u672C\u8F6E\u5BF9\u8BDD\u91CC\u80FD\u8BC1\u660E\u5B83\u7684\u539F\u8BDD\uFF0C\u9010\u5B57\u590D\u5236\u3002\u5DF2\u8BB0\u5F55\u8FC7\u7684\u540C\u4E00\u4EF6\u4E8B\u7528\u5B83\u7684 factId \u66F4\u65B0\uFF1B\u7528\u6237\u8BF4\u67D0\u4E2A\u503C\u4E0D\u518D\u6210\u7ACB\u6216\u8FD8\u6CA1\u5B9A\u65F6\uFF0C\u8F93\u51FA op \u4E3A \"retract\" \u5E76\u7ED9\u51FA\u7528\u6237\u539F\u8BDD\u3002\u6CA1\u6709\u5C31\u8F93\u51FA\u7A7A\u6570\u7EC4\u3002\n\u53EA\u8F93\u51FA JSON \u6570\u7EC4\uFF0C\u4F8B\u5982 [{\"op\":\"set\",\"factId\":null,\"label\":\"\u9884\u7B97\",\"kind\":\"fact\",\"value\":\"800\",\"evidenceQuote\":\"\u9884\u7B97\u5B9A\u4E3A 800 \u5143\"}]\u3002kind \u53EA\u80FD\u662F fact\u3001decision\u3001artifact\u3002";
/** The extraction request for the turn that just ended: cleaned, and within its size budget. */
export declare function extractionPayload(events: readonly EvidenceEvent[], base: readonly FactView[]): {
    user: string;
    assistant: string;
    facts: object[];
} | undefined;
/**
 * Store what an extraction returned, by the same rules as a Worker's record: evidence is checked in
 * the session, and every write expects the version the topic had when the turn ended, so a late
 * extraction cannot overwrite a newer value. Returns how many items were stored.
 */
export declare function applyExtraction(store: ContextStore, input: {
    sessionId: string;
    contextId: string;
    events: readonly EvidenceEvent[];
    base: readonly FactView[];
    items: unknown;
}): number;
