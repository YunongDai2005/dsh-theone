export class GatewayNavigation {
    host;
    storage;
    key;
    uuid;
    pending;
    listeners = new Set();
    constructor(host, storage, key, uuid) {
        this.host = host;
        this.storage = storage;
        this.key = key;
        this.uuid = uuid;
    }
    getSnapshot = () => this.storage.getItem(this.key);
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    async open() {
        const signal = this.host.beginNavigation();
        this.pending ??= this.ensure().finally(() => { this.pending = undefined; });
        const id = await this.pending;
        if (!signal.aborted)
            this.host.open(id);
        return id;
    }
    async ensure() {
        let id = this.getSnapshot();
        if (!id) {
            const known = await this.host.current().catch(() => undefined);
            id = known && await this.host.exists(known) ? known : this.uuid();
            // Reserve before the RPC: retries adopt the same id after an ambiguous response.
            this.storage.setItem(this.key, id);
            for (const listener of this.listeners)
                listener();
        }
        if (!await this.host.exists(id))
            await this.host.create(id);
        await this.host.prepare(id);
        return id;
    }
}
