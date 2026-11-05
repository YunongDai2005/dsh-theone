/** Worker preparations may overlap; structural maintenance excludes every preparation. */
export declare class TopicMaintenance {
    private readers;
    private writer?;
    private readonly lifetime;
    isBusy(): boolean;
    start(signal?: AbortSignal): Promise<() => void>;
    tryMaintain(): (() => void) | undefined;
    close(): void;
}
