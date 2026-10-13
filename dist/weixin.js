import { RELAY_WORDS, RemoteRelay } from "./remote-relay.js";
import { plainText } from "./remote-plain.js";
import { IlinkClient, splitText } from "./weixin-ilink.js";
import { WeixinLink } from "./weixin-link.js";
/** Main chat messages from WeChat carry this prefix on their request id (`source.rpcId`). */
export const WEIXIN_REQUEST = 'weixin:';
const EXPIRED = {
    zh: '微信登录已失效，在 TheOne 设置的「微信」里重新扫码即可恢复。',
    en: 'The WeChat login has expired. Scan again under WeChat in TheOne\'s settings to restore it.',
};
export class WeixinBridge {
    ctx;
    client;
    link;
    relay;
    constructor(ctx, host) {
        this.ctx = ctx;
        this.client = new IlinkClient(host.version);
        this.relay = new RemoteRelay(ctx, host, {
            name: WEIXIN_REQUEST.slice(0, -1),
            available: () => !!this.link.account(),
            send: text => this.say(text),
            typing: async () => {
                const account = this.link.account();
                if (account)
                    await this.client.typing(account, account.userId, true, this.link.contextToken());
            },
        });
        this.link = new WeixinLink({
            client: this.client,
            load: host.load,
            save: host.save,
            deliver: message => this.relay.receive(message.id, message.text),
            expired: () => this.relay.note(this.relay.words() === RELAY_WORDS.en ? EXPIRED.en : EXPIRED.zh),
            log: message => console.warn(`TheOne: ${message}`),
        });
    }
    /** Answer main chat's WeChat turns, and receive while TheOne runs. */
    apply() {
        this.relay.apply();
        this.ctx.effect(() => {
            this.link.start();
            return async () => {
                this.link.cancelLogin();
                await this.link.stop();
            };
        });
    }
    /** Text to the owner, plain and in parts WeChat accepts, in the conversation they last wrote in. */
    async say(text) {
        const account = this.link.account();
        if (!account)
            return;
        const token = this.link.contextToken();
        for (const part of splitText(plainText(text)))
            await this.client.send(account, account.userId, part, token);
    }
    /** The settings page: status, and login, pause, resume and logout. */
    async handle(request) {
        if (request.method === 'POST') {
            let row;
            try {
                row = await request.json();
            }
            catch {
                return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
            }
            switch (row?.action) {
                case 'login':
                    await this.link.beginLogin();
                    break;
                case 'cancel':
                    this.link.cancelLogin();
                    break;
                case 'verify':
                    if (typeof row.code !== 'string' || !/^\s*\w{1,16}\s*$/.test(row.code))
                        return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
                    this.link.verify(row.code);
                    break;
                case 'enable':
                case 'disable':
                    await this.link.setEnabled(row.action === 'enable');
                    break;
                case 'logout':
                    await this.link.logout();
                    break;
                default: return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
            }
        }
        return Response.json(this.link.status(), { headers: { 'cache-control': 'no-store' } });
    }
}
