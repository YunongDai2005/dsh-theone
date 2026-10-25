/**
 * Telegram for main chat: a bot the user made with @BotFather, bound to them by a pairing code,
 * plus the relay that carries their messages into main chat and the replies back.
 */
import type { Context } from '@deepseek-ai/cordis';
import { RemoteRelay } from './remote-relay.ts';
import { RemoteApp, type AppHost } from './remote-app.ts';
import { TelegramClient, TelegramLink, type TelegramSaved } from './telegram-bot.ts';
/** Main chat messages from Telegram carry this prefix on their request id (`source.rpcId`). */
export declare const TELEGRAM_REQUEST = "telegram:";
export declare class TelegramApp extends RemoteApp<TelegramSaved> {
    readonly client: TelegramClient;
    readonly link: TelegramLink;
    readonly relay: RemoteRelay;
    constructor(ctx: Context, host: AppHost<TelegramSaved>);
    /** Text to the owner, plain and in parts Telegram accepts. */
    say(text: string): Promise<void>;
    protected action(row: Record<string, unknown>): Promise<Response | undefined>;
}
