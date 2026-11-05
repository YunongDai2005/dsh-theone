/** Canonical repository root, or workspace root when it is not a Git checkout. */
export declare function projectKey(folder: string): string;
export declare class ProjectQueue {
    private readonly tails;
    private readonly lifetime;
    isBusy(key: string): boolean;
    acquire(key: string, signal?: AbortSignal): Promise<() => void>;
    close(): void;
}
