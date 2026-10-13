/**
 * WeChat for main chat: the iLink account (QR login, staying connected) plus the relay that carries
 * its owner's messages into main chat and the replies, approvals and questions back.
 */
import type { Context } from '@deepseek-ai/cordis';
import { RemoteRelay } from './remote-relay.ts';
import { RemoteApp, type AppHost } from './remote-app.ts';
import { IlinkClient } from './weixin-ilink.ts';
import { WeixinLink, type WeixinSaved } from './weixin-link.ts';
/** Main chat messages from WeChat carry this prefix on their request id (`source.rpcId`). */
export declare const WEIXIN_REQUEST = "weixin:";
export declare class WeixinBridge extends RemoteApp<WeixinSaved> {
    readonly client: IlinkClient;
    readonly link: WeixinLink;
    readonly relay: RemoteRelay;
    constructor(ctx: Context, host: AppHost<WeixinSaved>);
    /** Text to the owner, plain and in parts WeChat accepts, in the conversation they last wrote in. */
    say(text: string): Promise<void>;
    protected cancel(): void;
    protected action(row: Record<string, unknown>): Promise<Response | undefined>;
}
