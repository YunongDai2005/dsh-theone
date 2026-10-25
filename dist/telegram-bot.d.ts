import { RemoteLink, type LinkSaved, type LinkSource, type LinkStatus, type RemoteLinkDeps } from './remote-link.ts';
export declare const TELEGRAM_API = "https://api.telegram.org";
/** A reply longer than this is sent in parts. */
export declare const TELEGRAM_TEXT_LIMIT = 4096;
export interface TelegramSaved extends LinkSaved {
    token: string;
    /** The bot's @username, for the user to recognise and to open it. */
    bot: string;
    /** The person allowed to talk to main chat, once they sent the pairing code. */
    owner?: {
        userId: number;
        chatId: number;
        name: string;
    };
    /** Shown in Settings until the owner sends it to the bot. */
    pairing?: string;
}
export interface TelegramStatus extends LinkStatus {
    /** Waiting for the owner to send this code to the bot. */
    pairing?: {
        bot: string;
        code: string;
    };
}
/** A plausible bot token: "<digits>:<35 or so url-safe characters>". */
export declare const TOKEN_PATTERN: RegExp;
type Fetch = typeof fetch;
export declare class TelegramClient {
    private readonly base;
    /** The HTTP client; replaced in tests by a scripted server. */
    fetchImpl: Fetch;
    constructor(base?: string);
    /** Call one Bot API method; a failure carries Telegram's error code (401 for a revoked token). */
    call<T>(token: string, method: string, body: Record<string, unknown>, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<T>;
    /** The bot behind a token: its @username. */
    me(token: string): Promise<{
        username: string;
    }>;
    send(token: string, chatId: number, text: string): Promise<void>;
    typing(token: string, chatId: number): Promise<void>;
}
/** Polling getUpdates: messages from the owner's private chat; pairing binds the first person to send the code. */
export declare function telegramSource(client: TelegramClient, words: () => {
    paired: string;
}): LinkSource<TelegramSaved>;
export declare class TelegramLink extends RemoteLink<TelegramSaved> {
    private readonly client;
    constructor(client: TelegramClient, deps: Omit<RemoteLinkDeps<TelegramSaved>, 'source'>, words: () => {
        paired: string;
    });
    status(): TelegramStatus;
    /** Check a pasted token with Telegram, then bind it and wait for the owner to send the pairing code. */
    connect(token: string): Promise<void>;
}
export {};
