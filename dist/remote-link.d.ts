/**
 * Keeps one messaging-app account receiving: the polling loop, and staying online across network
 * failures, refused credentials and restarts. Each app supplies a `LinkSource` (how to poll it);
 * this knows nothing of DSH, and messages go to `deliver`.
 */
/** What every app saves between runs; each adds its own credentials. These never leave the host. */
export interface LinkSaved {
    /** Receiving is on (the user can pause it without logging out). */
    enabled: boolean;
    /** The app's position in its message stream, so a restart neither loses nor repeats messages. */
    cursor: string;
    /** The credentials stopped working: the user has to sign in again. */
    expired?: boolean;
    /** Ids of the last messages delivered, so a replayed round is not delivered twice. */
    seen?: string[];
}
/** One message from the account's owner. */
export interface LinkMessage {
    id: string;
    text: string;
}
export type PollResult<S> = {
    kind: 'ok';
    messages: LinkMessage[];
    cursor: string;
    patch?: Partial<S>;
    nextTimeoutMs?: number;
}
/** Credentials refused, perhaps for a while: wait an hour; a second refusal in a row means sign in again. */
 | {
    kind: 'stale';
}
/** Credentials refused for good. */
 | {
    kind: 'expired';
} | {
    kind: 'error';
    message: string;
};
export interface LinkSource<S extends LinkSaved> {
    /** What changes when the user signs in again; a loop for other credentials stops. */
    identity(saved: S): string;
    /** How the user recognises the account; never a secret. */
    label(saved: S): string;
    /** One round: new messages from the owner only (the source filters out everyone else). */
    poll(saved: S, timeoutMs: number, signal: AbortSignal): Promise<PollResult<S>>;
    /** How long one round may wait for messages (long polling). */
    timeoutMs: number;
    /** Pause between rounds, for sources that do not hold the request open. */
    intervalMs?: number;
    /** Tell the app receiving starts or stops; best effort. */
    started?(saved: S): Promise<void>;
    stopped?(saved: S): Promise<void>;
}
export interface LinkStatus {
    state: 'off' | 'online' | 'paused' | 'expired' | 'connecting';
    account?: string;
    pausedUntil?: number;
    lastError?: string;
    lastMessageAt?: number;
}
export interface RemoteLinkDeps<S extends LinkSaved> {
    source: LinkSource<S>;
    load(): S | undefined;
    save(saved: S | undefined): void;
    /** Hand one message from the owner to main chat; resolves once it is accepted. */
    deliver(message: LinkMessage): Promise<void>;
    /** The credentials stopped working for good. */
    expired?(): void;
    sleep?(ms: number, signal: AbortSignal): Promise<void>;
    now?(): number;
    random?(): number;
    log?(message: string): void;
}
/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
export declare function abortableSleep(ms: number, signal: AbortSignal): Promise<void>;
/** Exponential delay after `failures` consecutive failures, capped, with ±20% jitter. */
export declare function backoff(failures: number, random?: () => number): number;
export declare class RemoteLink<S extends LinkSaved> {
    protected readonly deps: RemoteLinkDeps<S>;
    private loop?;
    private pausedUntil?;
    protected lastError?: string;
    private lastMessageAt?;
    /** Advances on every poll; the watchdog restarts a loop that stops advancing. */
    private beat;
    private lastBeat;
    private watchdog?;
    protected readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
    private readonly now;
    private readonly random;
    constructor(deps: RemoteLinkDeps<S>);
    status(): LinkStatus;
    /** The saved account, unless it expired: what replies are sent with. */
    current(): S | undefined;
    /** Start receiving if an account is bound and receiving is on (TheOne starting, or the user resuming). */
    start(): void;
    /** Stop receiving (pausing, logging out, TheOne stopping); the app is told, best effort. */
    stop(): Promise<void>;
    setEnabled(enabled: boolean): Promise<void>;
    /** Bind new credentials (after a login) and start receiving with them. */
    bind(saved: S): Promise<void>;
    logout(): Promise<void>;
    private run;
    private poll;
    /** The loop has not polled for several rounds: it is stuck, so start it again. */
    private checkBeat;
}
