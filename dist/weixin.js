import { RELAY_WORDS, RemoteRelay } from "./remote-relay.js";
import { plainText, splitText } from "./remote-plain.js";
import { RemoteApp, refused } from "./remote-app.js";
import { IlinkClient, TEXT_LIMIT } from "./weixin-ilink.js";
import { WeixinLink } from "./weixin-link.js";
/** Main chat messages from WeChat carry this prefix on their request id (`source.rpcId`). */
export const WEIXIN_REQUEST = 'weixin:';
const EXPIRED = {
    zh: '微信登录已失效，在 TheOne 设置的「微信」里重新扫码即可恢复。',
    en: 'The WeChat login has expired. Scan again under WeChat in TheOne\'s settings to restore it.',
};
export class WeixinBridge extends RemoteApp {
    client;
    link;
    relay;
    constructor(ctx, host) {
        super(ctx);
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
        this.link = new WeixinLink(this.client, {
            load: host.load,
            save: host.save,
            deliver: message => this.relay.receive(message.id, message.text),
            expired: () => this.relay.note(this.relay.words() === RELAY_WORDS.en ? EXPIRED.en : EXPIRED.zh),
            log: message => console.warn(`TheOne: ${message}`),
        });
    }
    /** Text to the owner, plain and in parts WeChat accepts, in the conversation they last wrote in. */
    async say(text) {
        const account = this.link.account();
        if (!account)
            return;
        const token = this.link.contextToken();
        for (const part of splitText(plainText(text), TEXT_LIMIT))
            await this.client.send(account, account.userId, part, token);
    }
    cancel() {
        this.link.cancelLogin();
    }
    async action(row) {
        switch (row.action) {
            case 'login':
                await this.link.beginLogin();
                return;
            case 'cancel':
                this.link.cancelLogin();
                return;
            case 'verify':
                if (typeof row.code !== 'string' || !/^\s*\w{1,16}\s*$/.test(row.code))
                    return refused('INVALID_INPUT');
                this.link.verify(row.code);
                return;
        }
        return refused('INVALID_INPUT');
    }
}
