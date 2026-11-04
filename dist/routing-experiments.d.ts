import { type RoutingPayload, type RecentMessage } from './llm-router.ts';
export declare const ROUTING_VARIANTS: readonly ["none", "snapshot", "compact", "snapshot+compact"];
export type RoutingVariant = typeof ROUTING_VARIANTS[number];
export declare function routingVariant(value?: unknown): RoutingVariant;
type SnapshotPayload = RoutingPayload & {
    contexts: (RoutingPayload['contexts'][number] & {
        routeId?: string;
    })[];
};
interface Overlay {
    contexts?: {
        remove: string[];
        upsert: SnapshotPayload['contexts'];
        order?: string[];
    };
    recent?: {
        drop: number;
        append: RecentMessage[];
    };
    set?: Record<string, unknown>;
    unset?: string[];
}
export interface SnapshotWire {
    protocol: 'snapshot-v1';
    epoch: number;
    snapshot: SnapshotPayload;
    overlay: Overlay[];
}
/** Materialize from the immutable trunk, applying every overlay from left to right. */
export declare function materializeSnapshot(wire: SnapshotWire): SnapshotPayload;
/** Per gateway session, shared synchronously by quick/recheck/review. Eviction only causes a cold epoch. */
export declare class SnapshotCache {
    private readonly limits;
    private sessions;
    private sequence;
    constructor(limits?: Partial<{
        overlayRatio: number;
        minOverlayTokens: number;
        maxChars: number;
        sessions: number;
    }>);
    prepare(payload: SnapshotPayload, session?: string): SnapshotWire;
}
/** Content-derived aliases never get reassigned on a new epoch; only this request's candidates are valid. */
export declare function compactPayload(payload: RoutingPayload): {
    payload: SnapshotPayload;
    aliases: Map<string, string>;
};
type DecisionRow = Record<string, unknown>;
/** Omit only protocol defaults. False, nonempty optional fields and an explicit reason are preserved. */
export declare function compressDecision(value: unknown, aliases: Map<string, string>): DecisionRow;
export declare function expandDecision(value: unknown, aliases: Map<string, string>): DecisionRow;
export declare class RoutingExperiments {
    private snapshots;
    prepare(payload: RoutingPayload, variant?: RoutingVariant, session?: string): {
        system: string;
        user: string;
        decode: (value: unknown) => unknown;
    };
}
export {};
