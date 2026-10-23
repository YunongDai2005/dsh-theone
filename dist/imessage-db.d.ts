import { RemoteLink, type LinkSaved, type LinkSource, type LinkStatus, type RemoteLinkDeps } from './remote-link.ts';
export declare const MESSAGES_DB: string;
export interface IMessageSaved extends LinkSaved {
    /** The phone number or Apple ID email of the person allowed to talk to main chat (the user's own). */
    handle: string;
    /** That handle is this Mac's own account: the user texts themselves, so their messages count as sent. */
    self: boolean;
}
export interface IMessageStatus extends LinkStatus {
    /** Only macOS has Messages. */
    supported: boolean;
}
/** Phone numbers compared by their last 9 digits (country codes and spacing vary); emails case-insensitively. */
export declare function sameHandle(a: string, b: string): boolean;
/** A phone number or an email address. */
export declare const HANDLE_PATTERN: RegExp;
/**
 * The text of a message newer macOS versions store only in `attributedBody` (a serialized
 * NSAttributedString): the string follows the "NSString" class name, after a length prefix.
 */
export declare function attributedText(blob: Uint8Array | null | undefined): string;
interface Row {
    rowid: number;
    text: string | null;
    body: Uint8Array | null;
    mine: number;
    sender: string | null;
    chat: string | null;
    style: number | null;
}
type Run = (file: string, args: string[]) => Promise<void>;
export declare class MessagesDatabase {
    /** Replaced in tests: where the database is and how osascript runs. */
    path: string;
    run: Run;
    private readonly sent;
    private open;
    /** The newest message now, so receiving starts from here and not from years of history. */
    latest(): number;
    /** The handle is one of this Mac's own iMessage accounts (messages record theirs as "E:…" or "P:…"). */
    ownAccount(handle: string): boolean;
    /** Messages after `after` in one-to-one chats, oldest first. */
    read(after: number): Row[];
    /** Something we sent lately, so it is not read back as the user's own message in a chat with oneself. */
    sentRecently(text: string, now?: number): boolean;
    send(handle: string, text: string): Promise<void>;
}
/** Reading new rows: the owner's messages in their one-to-one chat; style 45 is a one-to-one chat, 43 a group. */
export declare function imessageSource(db: MessagesDatabase, now?: () => number): LinkSource<IMessageSaved>;
export declare class IMessageLink extends RemoteLink<IMessageSaved> {
    private readonly db;
    private readonly platform;
    constructor(db: MessagesDatabase, deps: Omit<RemoteLinkDeps<IMessageSaved>, 'source'>, platform?: NodeJS.Platform);
    status(): IMessageStatus;
    /** Listen to `handle` from the newest message on. */
    connect(handle: string): Promise<void>;
}
export {};
