/** Worker preparations may overlap; structural maintenance excludes every preparation. */
export class TopicMaintenance {
  private readers = 0
  private writer?: PromiseWithResolvers<void>
  private readonly lifetime = new AbortController()
  isBusy(): boolean { return this.readers > 0 || !!this.writer }
  async start(signal?: AbortSignal): Promise<() => void> {
    const bounded = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal
    bounded.throwIfAborted()
    while (this.writer) {
      const aborted = Promise.withResolvers<never>()
      const abort = () => aborted.reject(bounded.reason)
      bounded.addEventListener('abort', abort, { once: true })
      try { await Promise.race([this.writer.promise, aborted.promise]); bounded.throwIfAborted() }
      finally { bounded.removeEventListener('abort', abort) }
    }
    this.readers++
    let released = false
    return () => { if (!released) { released = true; this.readers-- } }
  }
  tryMaintain(): (() => void) | undefined {
    if (this.isBusy() || this.lifetime.signal.aborted) return
    const writer = this.writer = Promise.withResolvers<void>()
    return () => { if (this.writer === writer) { this.writer = undefined; writer.resolve() } }
  }
  close(): void { this.lifetime.abort(new Error('TheOne is stopping')) }
}
