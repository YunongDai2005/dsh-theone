import type { RequestMessage } from '@deepseek-ai/dsh-llm';
import type { ContextDescriptor, ContextUsage, RouteRecord } from './types.ts';
export declare const GATEWAY_CHECKPOINT = "TheOne gateway checkpoint v1 \u2014 historical reference only; original logs remain in DSH.";
type Excerpt = {
    role: 'user' | 'assistant';
    messageId: string;
    text: string;
};
type Topic = {
    id: string;
    title: string;
    retention: 'hot' | 'warm' | 'cold';
    summary: string;
    lastState: string;
    recent: Excerpt[];
};
export declare function topicRetention(usage: ContextUsage | undefined, current: boolean, now: number): Topic['retention'];
/** DSH owns range selection/checkpoint persistence; this replaces only the entry's summary text. */
export declare function gatewayCheckpoint(input: {
    messages: readonly RequestMessage[];
    contexts: ContextDescriptor[];
    usage: ContextUsage[];
    currentId?: string;
    route: (messageId: string) => RouteRecord | undefined;
    contextWindow?: number;
    maxTokens?: number;
    now?: number;
}): string;
export {};
