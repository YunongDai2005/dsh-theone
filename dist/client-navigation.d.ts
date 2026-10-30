/** Browser-local identity; history and conversation content remain on the DSH host. */
export interface GatewayNavigationHost {
    /** The main chat this DSH already has, so another browser or device continues it. */
    current(): Promise<string | undefined>;
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
    /** Main chat's id once it is open, or undefined when a later navigation took over first. */
    open(): Promise<string | undefined>;
    private ensure;
}
