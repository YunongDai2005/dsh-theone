/**
 * Hosts the topic cluster under TheOne's sidebar card: keeps its box aligned under the card, makes room
 * for it, turns the user's gestures into TheOne's existing topic operations, and feeds it TheOne's state.
 * The box lives on document.body (DSH owns the sidebar's DOM), positioned under the card every frame.
 */
import { type FoamEvent, type FoamModel, type FoamPhase, type FoamTextKey, type FoamTopic } from './client-foam.ts';
import type { CatalogSnapshot } from './catalog-types.ts';
import type { BubbleEvent, BubbleMerge, BubbleSnapshot, BubbleWorkItem } from './bubble-types.ts';
/**
 * The finer status behind a phase, for the topic's details: which of routing/starting/answering/recovering, whether it waits
 * on a question or an approval, and why it is queued. Only what the work items say; nothing is guessed.
 */
export declare function statusOf(items: BubbleWorkItem[], phase: FoamPhase): Pick<FoamTopic, 'status' | 'queueReason'>;
/** The cluster's model from TheOne's bubble snapshot. Weight: recency (half-life about three days) and the last 30 days' use. */
export declare function modelFromBubbles(snapshot: BubbleSnapshot): FoamModel;
/**
 * Possible duplicates TheOne noticed and keeps for the user: pending, not past their time, both topics on the
 * cluster, and neither already in a merge. Each keeps both directions, TheOne's default (new into old) first.
 */
export declare function suggestionsFromBubbles(snapshot: BubbleSnapshot): NonNullable<FoamModel['suggestions']>;
/** What each routing event looks like on the cluster. Hints and bookkeeping events play nothing. */
export declare function foamEventsFrom(events: BubbleEvent[], snapshot: BubbleSnapshot): FoamEvent[];
/**
 * One feed batch's animations checked against the state it ended in, so an older event never undoes a newer state: of the
 * merges and undos of one source only the last plays, and only if the snapshot agrees (a merge whose source it still lists,
 * merged then undone in the same batch, plays nothing; nor does an undo whose source is gone again).
 */
export declare function settleFoamEvents(events: FoamEvent[], snapshot: Pick<BubbleSnapshot, 'topics'>): FoamEvent[];
/**
 * How queued merges ended, each exactly once: `seen` keeps every operation's last state, a finished one is never overwritten
 * by an older state read later (history replayed after a receipt), and only a merge last seen queued or executing reports its end.
 * Pass the batch's history first and its snapshot and receipts after.
 */
export declare function mergeOutcomes(seen: Map<string, BubbleMerge['state']>, merges: Iterable<Pick<BubbleMerge, 'operationId' | 'sourceId' | 'targetId' | 'state' | 'error'>>): FoamEvent[];
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
    /** The sidebar is collapsed when the cluster mounts. */
    rail?: boolean;
}
export interface FoamHost {
    setRail(on: boolean): void;
    refresh(): void;
    destroy(): void;
}
/** Until the cluster's own state endpoint is there, the topic directory gives topics, workspaces, relatedness and status. */
export declare function modelFromCatalog(snapshot: CatalogSnapshot): FoamModel;
export declare function mountFoamHost(options: FoamHostOptions): FoamHost;
