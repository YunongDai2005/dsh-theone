import { RemoteRelay } from "./remote-relay.js";
import { plainText, splitText } from "./remote-plain.js";
import { RemoteApp, refused } from "./remote-app.js";
import { IMessageLink, MessagesDatabase } from "./imessage-db.js";
/** Main chat messages from iMessage carry this prefix on their request id (`source.rpcId`). */
export const IMESSAGE_REQUEST = 'imessage:';
/** Long replies are sent in parts of this size. */
const PART = 8000;
export class IMessageApp extends RemoteApp {
    db = new MessagesDatabase();
    link;
    relay;
    constructor(ctx, host, platform = process.platform) {
        super(ctx);
        this.relay = new RemoteRelay(ctx, host, {
            name: IMESSAGE_REQUEST.slice(0, -1),
            available: () => !!this.link.current(),
            send: text => this.say(text),
        });
        this.link = new IMessageLink(this.db, {
            load: host.load,
            save: host.save,
            deliver: message => this.relay.receive(message.id, message.text),
            log: message => console.warn(`TheOne: ${message}`),
        }, platform);
    }
    async say(text) {
        const saved = this.link.current();
        if (!saved)
            return;
        for (const part of splitText(plainText(text), PART))
            await this.db.send(saved.handle, part);
    }
    async action(row) {
        if (row.action !== 'connect')
            return refused('INVALID_INPUT');
        if (typeof row.handle !== 'string' || row.handle.length > 200)
            return refused('IMESSAGE_HANDLE_INVALID');
        try {
            await this.link.connect(row.handle);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return refused(/^IMESSAGE_[A-Z_]+$/.test(message) ? message : 'IMESSAGE_FAILED');
        }
    }
}
