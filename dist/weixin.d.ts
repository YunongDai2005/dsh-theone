/**
 * WeChat for main chat: the iLink account (login, staying connected) plus the relay that carries its
 * owner's messages into main chat and the replies, approvals and questions back.
 */
import type { Context } from '@deepseek-ai/cordis';
import { RemoteRelay, type RelayHost } from './remote-relay.ts';
import { IlinkClient } from './weixin-ilink.ts';
import { WeixinLink, type WeixinSaved } from './weixin-link.ts';
/** Main chat messages from WeChat carry this prefix on their request id (`source.rpcId`). */
export declare const WEIXIN_REQUEST = "weixin:";
export interface BridgeHost extends RelayHost {
    load(): WeixinSaved | undefined;
    save(saved: WeixinSaved | undefined): void;
    version: string;
}
export declare class WeixinBridge {
    private readonly ctx;
    readonly client: IlinkClient;
    readonly link: WeixinLink;
    readonly relay: RemoteRelay;
    constructor(ctx: Context, host: BridgeHost);
    /** Answer main chat's WeChat turns, and receive while TheOne runs. */
    apply(): void;
    /** Text to the owner, plain and in parts WeChat accepts, in the conversation they last wrote in. */
    say(text: string): Promise<void>;
    /** The settings page: status, and login, pause, resume and logout. */
    handle(request: Request): Promise<Response>;
}
