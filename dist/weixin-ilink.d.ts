export declare const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
/** The server answers -14 when the bot token has expired or was revoked. */
export declare const STALE_TOKEN = -14;
/** How long the server may hold getupdates, unless it suggests another value. */
export declare const LONG_POLL_MS = 35000;
/** A reply longer than this is sent in parts. */
export declare const TEXT_LIMIT = 4000;
/** A bound WeChat bot: what login returns and every later request needs. */
export interface IlinkAccount {
    botId: string;
    token: string;
    baseUrl: string;
    /** The person who scanned the code; the only one whose messages reach main chat. */
    userId: string;
}
export type QrState = {
    status: 'wait' | 'scanned' | 'need_verifycode' | 'expired' | 'verify_code_blocked' | 'binded_redirect';
} | {
    status: 'redirect';
    baseUrl: string;
} | {
    status: 'confirmed';
    account: IlinkAccount;
};
export interface InboundMessage {
    id: string;
    from: string;
    text: string;
    contextToken?: string;
}
export type UpdatesResult = {
    kind: 'ok';
    messages: InboundMessage[];
    buf: string;
    nextTimeoutMs?: number;
} | {
    kind: 'stale';
} | {
    kind: 'error';
    message: string;
};
type Fetch = typeof fetch;
/** `iLink-App-ClientVersion`: 0x00MMNNPP of a semantic version. */
export declare function clientVersion(version: string): number;
/** The words of a message: its text items, and the transcript WeChat attaches to a voice message. */
export declare function messageWords(items: readonly {
    type?: number;
    text_item?: {
        text?: string;
    };
    voice_item?: {
        text?: string;
    };
}[] | undefined): string;
export declare class IlinkClient {
    private readonly botAgent;
    private readonly version;
    private readonly tickets;
    /** The HTTP client; replaced in tests by a scripted server. */
    fetchImpl: Fetch;
    constructor(version: string, fetchImpl?: Fetch, botAgent?: string);
    /** A new login code; `url` is what the QR image encodes. */
    qrcode(signal?: AbortSignal): Promise<{
        qrcode: string;
        url: string;
    }>;
    /** Long-poll the login code's state; a timeout or a gateway error reads as still waiting. */
    qrStatus(qrcode: string, baseUrl?: string, verifyCode?: string, signal?: AbortSignal): Promise<QrState>;
    /**
     * One long poll for new messages. A client-side timeout is an ordinary empty round, not a failure;
     * messages the bot sent itself are left out.
     */
    updates(account: IlinkAccount, buf: string, timeoutMs?: number, signal?: AbortSignal): Promise<UpdatesResult>;
    /** Send one text message; `contextToken` from the message it answers ties it to that conversation. */
    send(account: IlinkAccount, to: string, text: string, contextToken?: string): Promise<void>;
    /** Show or clear "typing…" to `to`; best effort, the ticket is fetched once per person. */
    typing(account: IlinkAccount, to: string, on: boolean, contextToken?: string): Promise<void>;
    /** Tell the server this client starts or stops receiving; best effort. */
    notify(account: IlinkAccount, state: 'start' | 'stop'): Promise<void>;
    private baseInfo;
    private call;
}
export {};
