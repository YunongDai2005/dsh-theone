/**
 * Hosts the topic cluster under TheOne's sidebar card: keeps its box aligned under the card, makes room
 * for it, turns the user's gestures into TheOne's existing topic operations, and feeds it TheOne's state.
 * The box lives on document.body (DSH owns the sidebar's DOM), positioned under the card every frame.
 */
import { type FoamEvent, type FoamModel, type FoamTextKey } from './client-foam.ts';
import type { CatalogSnapshot } from './catalog-types.ts';
import type { BubbleEvent, BubbleSnapshot } from './bubble-types.ts';
/** The cluster's model from TheOne's bubble snapshot. Weight: recency (half-life about three days) and the last 30 days' use. */
export declare function modelFromBubbles(snapshot: BubbleSnapshot): FoamModel;
/** What each routing event looks like on the cluster. Hints and bookkeeping events play nothing. */
export declare function foamEventsFrom(events: BubbleEvent[], snapshot: BubbleSnapshot): FoamEvent[];
export interface FoamHostOptions {
    /** The sidebar card (DSH's panel row button that holds TheOne's entry). */
    button: HTMLElement;
    signal: AbortSignal;
    text(key: FoamTextKey, vars?: Record<string, string | number>): string;
    /** Main chat continues with this topic. */
    mount(contextId: string): Promise<void>;
    /** Open the topic's own chat. */
    openSession(sessionId: string): void;
    openWorkspace(): void;
    openMainChat(): void;
    /** How many topics the cluster shows; with none, the Topic workspaces row stays as the way in. */
    onTopics?(count: number): void;
}
export interface FoamHost {
    setRail(on: boolean): void;
    refresh(): void;
    destroy(): void;
}
/** Until the cluster's own state endpoint is there, the topic directory gives topics, workspaces, relatedness and status. */
export declare function modelFromCatalog(snapshot: CatalogSnapshot): FoamModel;
export declare function mountFoamHost(options: FoamHostOptions): FoamHost;
