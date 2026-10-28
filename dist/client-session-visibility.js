/** Browser-local sidebar state, refreshed from the host on relevant changes. */
export class SessionVisibility {
    read;
    changed;
    snapshot = { sessionIds: [], mainSessionIds: [], hideTopicSessions: false };
    request = 0;
    disposed = false;
    constructor(read, changed) {
        this.read = read;
        this.changed = changed;
    }
    hiddenIds(currentMain) {
        return [...new Set([
                ...(this.snapshot.hideTopicSessions ? this.snapshot.sessionIds : this.snapshot.mainSessionIds),
                ...(currentMain ? [currentMain] : []),
            ])];
    }
    async refresh() {
        if (this.disposed)
            return;
        const request = ++this.request;
        try {
            const value = await this.read();
            if (this.disposed || request !== this.request)
                return;
            this.snapshot = { ...value, mainSessionIds: value.mainSessionIds ?? [], hideTopicSessions: value.hideTopicSessions === true };
            this.changed();
        }
        catch { /* Keep the last usable sidebar state while offline. */ }
    }
    /** Invalidate immediately, even when the next read is debounced. */
    invalidate() { this.request++; }
    dispose() { this.disposed = true; this.invalidate(); }
}
