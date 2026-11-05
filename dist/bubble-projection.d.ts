import type { ContextStore } from './store.ts';
import type { BubbleGateway, BubbleScope, BubbleView, BubbleWorkItem, Capability } from './bubble-types.ts';
import type { LinkScope } from './linkage.ts';
/** One shared predicate for the displayed capability and the server's done guard. */
export declare function doneCapability(work: readonly BubbleWorkItem[]): Capability;
/** Synchronous, read-only and body-free. Never calls briefing, recovery, indexing, a Worker or a model. */
export declare function projectBubbles(store: ContextStore, input: {
    scope: BubbleScope;
    workItems?: readonly BubbleWorkItem[];
    gateway?: BubbleGateway | null;
    busy?: boolean;
    merges?: BubbleView['merges'];
    sessionCreatedAt?: ReadonlyMap<string, number>;
    doneCapabilities?: ReadonlyMap<string, Capability>;
    linkScope?: LinkScope;
    health?: BubbleView['health'];
    now?: number;
}): BubbleView;
