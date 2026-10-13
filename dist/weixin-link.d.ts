/**
 * Keeps one WeChat account connected: QR login, the long-poll loop, and staying online across
 * network failures, expired tokens and restarts. Knows nothing of DSH; messages go to `deliver`.
 */
import { IlinkClient, type IlinkAccount, type InboundMessage } from './weixin-ilink.ts';
/** What is saved between runs. The token never leaves the host. */
export interface WeixinSaved {
    account: IlinkAccount;
    /** Receiving is on (the user can pause it without logging out). */
    enabled: boolean;
    /** The server's sync cursor, so a restart neither loses nor repeats messages. */
    buf: string;
    /** The latest conversation token from the user; replies carry it. */
    contextToken?: string;
    /** The token was refused twice in a row: the user has to scan again. */
    expired?: boolean;
    /** Ids of the last messages delivered, so a replayed round is not delivered twice. */
    seen?: string[];
}
export type LoginState = {
    step: 'qr';
    url: string;
} | {
    step: 'scanned';
} | {
    step: 'verify';
} | {
    step: 'failed';
    reason: string;
};
export interface WeixinStatus {
    state: 'off' | 'online' | 'paused' | 'expired' | 'connecting';
    login?: LoginState;
    /** Short form of the bot id, for the user to recognise; never the token. */
    account?: string;
    pausedUntil?: number;
    lastError?: string;
    lastMessageAt?: number;
}
export interface LinkDeps {
    client: IlinkClient;
    load(): WeixinSaved | undefined;
    save(saved: WeixinSaved | undefined): void;
    /** Hand one message from the account's owner to main chat; resolves once it is accepted. */
    deliver(message: InboundMessage): Promise<void>;
    /** The token stopped working for good. */
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
export declare class WeixinLink {
    private readonly deps;
    private loop?;
    private loginRun?;
    private login?;
    private verifyCode?;
    private pausedUntil?;
    private lastError?;
    private lastMessageAt?;
    /** Advances on every poll; the watchdog restarts a loop that stops advancing. */
    private beat;
    private watchdog?;
    private readonly sleep;
    private readonly now;
    private readonly random;
    constructor(deps: LinkDeps);
    status(): WeixinStatus;
    /** The bound account, for replies. */
    account(): IlinkAccount | undefined;
    contextToken(): string | undefined;
    /** Start receiving if an account is bound and receiving is on (TheOne starting, or the user resuming). */
    start(): void;
    /** Stop receiving (pausing, logging out, TheOne stopping); the server is told, best effort. */
    stop(): Promise<void>;
    setEnabled(enabled: boolean): Promise<void>;
    logout(): Promise<void>;
    /** Begin a QR login; progress is read from `status().login`. */
    beginLogin(): Promise<LoginState>;
    /** The code WeChat showed on the phone, when it asks for one. */
    verify(code: string): void;
    cancelLogin(): void;
    private followLogin;
    private run;
    private poll;
    /** The loop has not polled for several long-poll periods: it is stuck, so start it again. */
    private lastBeat;
    private checkBeat;
}
