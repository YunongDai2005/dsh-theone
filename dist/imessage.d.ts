/**
 * iMessage for main chat, on a Mac: the user names the phone number or Apple ID they text from, and
 * the relay carries their messages into main chat and the replies back through the Messages app.
 */
import type { Context } from '@deepseek-ai/cordis';
import { RemoteRelay } from './remote-relay.ts';
import { RemoteApp, type AppHost } from './remote-app.ts';
import { IMessageLink, MessagesDatabase, type IMessageSaved } from './imessage-db.ts';
/** Main chat messages from iMessage carry this prefix on their request id (`source.rpcId`). */
export declare const IMESSAGE_REQUEST = "imessage:";
export declare class IMessageApp extends RemoteApp<IMessageSaved> {
    readonly db: MessagesDatabase;
    readonly link: IMessageLink;
    readonly relay: RemoteRelay;
    constructor(ctx: Context, host: AppHost<IMessageSaved>, platform?: NodeJS.Platform);
    say(text: string): Promise<void>;
    protected action(row: Record<string, unknown>): Promise<Response | undefined>;
}
