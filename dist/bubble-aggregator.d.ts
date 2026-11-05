import type { BubbleEventData, BubbleReadQuery, BubbleReadResponse, BubbleView } from './bubble-types.ts';
interface BubbleAggregatorOptions {
    capacity?: number;
    maxWaiters?: number;
    unavailableIds?: () => ReadonlySet<string>;
    topicIds?: () => readonly string[];
}
/** Single synchronous publisher: snapshot and event watermark always describe the same committed cut. */
export declare class BubbleAggregator {
    private readonly gatewayKey;
    private readonly project;
    private readonly gatewayIds;
    private readonly options;
    private epoch;
    private readonly heads;
    private readonly listeners;
    private readonly capacity;
    private closed;
    private readonly lifetime;
    private readonly waiters;
    private readonly maxWaiters;
    get pendingRequests(): number;
    constructor(gatewayKey: string, project: (id: string | null) => BubbleView, gatewayIds: () => string[], options?: BubbleAggregatorOptions);
    subscribe(listener: () => void): () => void;
    publish(events?: BubbleEventData[], gatewayId?: string | null): void;
    read(query?: BubbleReadQuery): BubbleReadResponse;
    poll(query?: BubbleReadQuery, signal?: AbortSignal): Promise<BubbleReadResponse>;
    close(): void;
    private topicEvents;
}
/** Reject malformed cursors instead of coercing negatives, floats, NaN or duplicate parameters. */
export declare function parseBubbleQuery(url: URL): BubbleReadQuery;
export {};
