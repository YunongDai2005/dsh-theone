import type { ContextDescriptor } from './types.ts';
export interface TopicGroup {
    id: string;
    title: string;
    summary: string;
    contextIds: string[];
}
export interface CatalogContext extends ContextDescriptor {
    workingSessionId: string;
    sourceSessionIds: string[];
}
export interface CatalogStatus {
    running: boolean;
    scanned: number;
    indexed: number;
    skipped: number;
    failed: number;
    pending: number;
    lastCompletedAt?: number;
    searchUnavailable?: boolean;
}
export interface CatalogSnapshot {
    groups: TopicGroup[];
    contexts: CatalogContext[];
    status: CatalogStatus;
}
export interface HistoryPart {
    seq: number;
    endSeq: number;
    text: string;
    fingerprint: string;
}
export interface ExtractedTopic {
    contextId: string | null;
    title: string;
    summary: string;
    entities: string[];
    keywords: string[];
    lastState: string;
    turns: number[];
    groupId: string | null;
    groupTitle: string | null;
    groupSummary: string;
}
