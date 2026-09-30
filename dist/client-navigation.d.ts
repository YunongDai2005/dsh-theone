/** Browser-local identity; history and conversation content remain on the DSH host. */
export interface GatewayNavigationHost {
    exists(id: string): Promise<boolean>;
    create(id: string): Promise<void>;
    prepare(id: string): Promise<void>;
    open(id: string): void;
    beginNavigation(): AbortSignal;
}
export declare class GatewayNavigation {
    private readonly host;
    private readonly storage;
    private readonly key;
    private readonly uuid;
    private pending?;
    private listeners;
    constructor(host: GatewayNavigationHost, storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, uuid: () => string);
    readonly getSnapshot: () => string | null;
    readonly subscribe: (listener: () => void) => () => void;
    open(): Promise<string>;
    private ensure;
}
