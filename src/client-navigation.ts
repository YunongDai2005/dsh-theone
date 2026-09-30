/** Browser-local identity; history and conversation content remain on the DSH host. */
export interface GatewayNavigationHost {
  exists(id: string): Promise<boolean>
  create(id: string): Promise<void>
  prepare(id: string): Promise<void>
  open(id: string): void
  beginNavigation(): AbortSignal
}

export class GatewayNavigation {
  private pending?: Promise<string>
  private listeners = new Set<() => void>()
  constructor(private readonly host: GatewayNavigationHost,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly key: string,
    private readonly uuid: () => string) {}

  readonly getSnapshot = (): string | null => this.storage.getItem(this.key)
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async open(): Promise<string> {
    const signal = this.host.beginNavigation()
    this.pending ??= this.ensure().finally(() => { this.pending = undefined })
    const id = await this.pending
    if (!signal.aborted) this.host.open(id)
    return id
  }

  private async ensure(): Promise<string> {
    let id = this.getSnapshot()
    if (!id) {
      id = this.uuid()
      // Reserve before the RPC: retries adopt the same id after an ambiguous response.
      this.storage.setItem(this.key, id)
      for (const listener of this.listeners) listener()
    }
    if (!await this.host.exists(id)) await this.host.create(id)
    await this.host.prepare(id)
    return id
  }
}
