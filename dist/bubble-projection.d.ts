import type { ContextStore } from './store.ts';
import type { BubbleEdge, BubbleGateway, BubbleScope, BubbleView, BubbleWorkItem, Capability } from './bubble-types.ts';
import type { LinkScope } from './linkage.ts';
/** One shared predicate for the displayed capability and the server's done guard. */
export declare function doneCapability(work: readonly BubbleWorkItem[]): Capability;
/** Facts belong to one publication, never to a cross-request cache. */
export declare function readBubbleProjection(store: ContextStore, gatewayKey: string, input?: {
    now?: number;
    linkScope?: LinkScope;
    sessionCreatedAt?: ReadonlyMap<string, number>;
}): {
    now: number;
    contexts: import("./types.ts").StoredContext[];
    hidden: Map<string, import("./catalog-types.ts").HiddenReason>;
    privateIds: Set<string>;
    unavailable: Set<string>;
    current: string | null;
    usage: Map<string, import("./types.ts").ContextUsage>;
    latest: Map<string, import("./store.ts").TopicRun>;
    declared: Map<string, {
        declared: "done";
        at: number;
    }>;
    dormancy: import("./topic-memory.ts").Dormancy;
    lastAt: Map<string, number>;
    groups: Map<string, string>;
    suggestions: import("./bubble-types.ts").BubbleMergeSuggestion[];
    routes: Map<string, import("./types.ts").RouteRecord | undefined>;
    labels: Map<string, string | null>;
    openSessions: Map<string, string>;
    edges: BubbleEdge[];
};
export type BubbleProjectionData = ReturnType<typeof readBubbleProjection>;
/** Synchronous, read-only and body-free. Never calls briefing, recovery, indexing, a Worker or a model. */
export declare function projectBubbles(store: ContextStore, input: {
    scope: BubbleScope;
    workItems?: readonly BubbleWorkItem[];
    gateway?: BubbleGateway | null;
    busy?: boolean;
    merges?: BubbleView['merges'];
    mergeReceipts?: BubbleView['merges'];
    sessionCreatedAt?: ReadonlyMap<string, number>;
    doneCapabilities?: ReadonlyMap<string, Capability>;
    linkScope?: LinkScope;
    health?: BubbleView['health'];
    now?: number;
    shared?: BubbleProjectionData;
}): BubbleView;
