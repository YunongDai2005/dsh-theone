import type { ContextDescriptor } from './types.ts';
export interface TopicGroup {
    id: string;
    title: string;
    summary: string;
    contextIds: string[];
}
/** Every conversation a topic draws on is gone from disk (`orphaned`) or archived in DSH (`archived`). */
export type HiddenReason = 'orphaned' | 'archived';
/** `hidden` says why routing and briefings skip this topic; the directory still lists it. */
export interface CatalogContext extends ContextDescriptor {
    workingSessionId: string;
    sourceSessionIds: string[];
    hidden?: HiddenReason;
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
    hidden?: number;
}
export type LinkReasonName = 'manual' | 'workspace' | 'project' | 'entities' | 'learned' | 'request';
export interface TopicLinkView {
    id: string;
    title: string;
    reasons: LinkReasonName[];
}
/** How topics share context: the scope setting and, per topic, its related topics and sharing flag. */
export interface LinkageSnapshot {
    scope: 'off' | 'workspace' | 'auto';
    topics: Record<string, {
        private: boolean;
        constraints?: string;
        related: TopicLinkView[];
    }>;
}
export interface CatalogSnapshot {
    groups: TopicGroup[];
    contexts: CatalogContext[];
    status: CatalogStatus;
    linkage?: LinkageSnapshot;
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
