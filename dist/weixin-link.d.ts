/**
 * One WeChat account for main chat: QR login, and receiving through iLink's long poll (the loop,
 * backoff and restarts are the generic `RemoteLink`'s). Knows nothing of DSH.
 */
import { IlinkClient, type IlinkAccount } from './weixin-ilink.ts';
import { RemoteLink, type LinkSaved, type LinkSource, type LinkStatus, type RemoteLinkDeps } from './remote-link.ts';
/** What is saved between runs. The token never leaves the host. */
export interface WeixinSaved extends LinkSaved {
    account: IlinkAccount;
    /** The latest conversation token from the owner; replies carry it. */
    contextToken?: string;
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
export interface WeixinStatus extends LinkStatus {
    login?: LoginState;
}
/** Polling iLink: only the person who scanned the code reaches main chat; -14 is a refused token. */
export declare function weixinSource(client: IlinkClient): LinkSource<WeixinSaved>;
export declare class WeixinLink extends RemoteLink<WeixinSaved> {
    private readonly client;
    private loginRun?;
    private login?;
    private verifyCode?;
    constructor(client: IlinkClient, deps: Omit<RemoteLinkDeps<WeixinSaved>, 'source'>);
    status(): WeixinStatus;
    /** The bound account, for replies. */
    account(): IlinkAccount | undefined;
    contextToken(): string | undefined;
    logout(): Promise<void>;
    /** Begin a QR login; progress is read from `status().login`. */
    beginLogin(): Promise<LoginState>;
    /** The code WeChat showed on the phone, when it asks for one. */
    verify(code: string): void;
    cancelLogin(): void;
    private followLogin;
}
