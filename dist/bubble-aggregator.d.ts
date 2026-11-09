import type { BubbleEventData, BubbleReadQuery, BubbleReadResponse, BubbleView } from './bubble-types.ts';
export interface BubblePublication {
    project: (id: string | null) => BubbleView;
    unavailableIds: ReadonlySet<string>;
    topicIds: readonly string[];
}
interface BubbleAggregatorOptions {
    capacity?: number;
    maxWaiters?: number;
    unavailableIds?: () => ReadonlySet<string>;
    topicIds?: () => readonly string[];
    prepare?: () => BubblePublication;
    /** Legacy standalone publishers keep synchronous transition observation. The service opts in. */
    defer?: boolean;
}
/** Flush commits all heads before notifying: snapshot and watermark describe the same cut. */
export declare class BubbleAggregator {
    private readonly gatewayKey;
    private readonly project;
    private readonly gatewayIds;
    private readonly options;
    private readonly heads;
    private readonly listeners;
    private readonly capacity;
    private closed;
    private readonly lifetime;
    private readonly waiters;
    private readonly maxWaiters;
    private readonly waiterScopes;
    private pending;
    private topicBoundary;
    private scheduled;
    get pendingRequests(): number;
    constructor(gatewayKey: string, project: (id: string | null) => BubbleView, gatewayIds: () => string[], options?: BubbleAggregatorOptions);
    subscribe(listener: () => void): () => void;
    publish(events?: BubbleEventData[], gatewayId?: string | null, synchronous?: boolean): void;
    /** Also used at mutation boundaries where intermediate topic transitions must remain observable. */
    flush(requested?: string | null): void;
    private prune;
    read(query?: BubbleReadQuery): BubbleReadResponse;
    private readScope;
    poll(query?: BubbleReadQuery, signal?: AbortSignal): Promise<BubbleReadResponse>;
    close(): void;
    private topicEvents;
}
/** Reject malformed cursors instead of coercing negatives, floats, NaN or duplicate parameters. */
export declare function parseBubbleQuery(url: URL): BubbleReadQuery;
export {};
