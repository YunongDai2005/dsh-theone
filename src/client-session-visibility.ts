/** Public ownership and display preference; never includes conversation contents. */
export interface OwnedSessions {
  sessionIds: string[]
  mainSessionIds: string[]
  hideTopicSessions: boolean
}

/** Browser-local sidebar state, refreshed from the host on relevant changes. */
export class SessionVisibility {
  private snapshot: OwnedSessions = { sessionIds: [], mainSessionIds: [], hideTopicSessions: false }
  private request = 0
  private disposed = false

  constructor(private readonly read: () => Promise<OwnedSessions>, private readonly changed: () => void) {}

  hiddenIds(currentMain?: string | null): string[] {
    return [...new Set([
      ...(this.snapshot.hideTopicSessions ? this.snapshot.sessionIds : this.snapshot.mainSessionIds),
      ...(currentMain ? [currentMain] : []),
    ])]
  }

  async refresh(): Promise<void> {
    if (this.disposed) return
    const request = ++this.request
    try {
      const value = await this.read()
      if (this.disposed || request !== this.request) return
      this.snapshot = { ...value, mainSessionIds: value.mainSessionIds ?? [], hideTopicSessions: value.hideTopicSessions === true }
      this.changed()
    } catch { /* Keep the last usable sidebar state while offline. */ }
  }

  /** Invalidate immediately, even when the next read is debounced. */
  invalidate(): void { this.request++ }

  dispose(): void { this.disposed = true; this.invalidate() }
}
