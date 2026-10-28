/** Public ownership and display preference; never includes conversation contents. */
export interface OwnedSessions {
    sessionIds: string[];
    mainSessionIds: string[];
    hideTopicSessions: boolean;
}
/** Browser-local sidebar state, refreshed from the host on relevant changes. */
export declare class SessionVisibility {
    private readonly read;
    private readonly changed;
    private snapshot;
    private request;
    private disposed;
    constructor(read: () => Promise<OwnedSessions>, changed: () => void);
    hiddenIds(currentMain?: string | null): string[];
    refresh(): Promise<void>;
    /** Invalidate immediately, even when the next read is debounced. */
    invalidate(): void;
    dispose(): void;
}
