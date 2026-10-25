/**
 * iMessage on the Mac DSH runs on: messages are read from Messages' own database
 * (~/Library/Messages/chat.db, read-only; DSH needs Full Disk Access for it) and replies are sent
 * through the Messages app with AppleScript. There is no iMessage API; this only works on macOS with
 * Messages signed in. Independent of DSH.
 */
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RemoteLink } from "./remote-link.js";
export const MESSAGES_DB = join(homedir(), 'Library', 'Messages', 'chat.db');
/** How often the database is read for new messages. */
const INTERVAL_MS = 2_000;
/** A reply sent by us shows up in the database too; in a chat with oneself it is told apart by its text. */
const SENT_REMEMBERED_MS = 5 * 60_000;
/** Phone numbers compared by their last 9 digits (country codes and spacing vary); emails case-insensitively. */
export function sameHandle(a, b) {
    const digits = (value) => value.replace(/\D/g, '');
    if (a.includes('@') || b.includes('@'))
        return a.trim().toLowerCase() === b.trim().toLowerCase();
    const x = digits(a), y = digits(b);
    return x.length >= 6 && y.length >= 6 && x.slice(-9) === y.slice(-9);
}
/** A phone number or an email address. */
export const HANDLE_PATTERN = /^(?:\+?[\d\s().-]{6,24}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;
/**
 * The text of a message newer macOS versions store only in `attributedBody` (a serialized
 * NSAttributedString): the string follows the "NSString" class name, after a length prefix.
 */
export function attributedText(blob) {
    if (!blob)
        return '';
    const bytes = Buffer.from(blob);
    const at = bytes.indexOf('NSString');
    if (at < 0)
        return '';
    let index = at + 'NSString'.length + 5;
    let length = bytes[index];
    if (length === 0x81) {
        length = bytes.readUInt16LE(index + 1);
        index += 3;
    }
    else if (length === 0x82) {
        length = bytes.readUIntLE(index + 1, 3);
        index += 4;
    }
    else
        index += 1;
    return bytes.subarray(index, index + length).toString('utf8');
}
const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { timeout: 30_000 }, error => error ? reject(error) : resolve()));
/** Sends to one person through the Messages app; the text is passed as an argument, never inside the script. */
const SEND_SCRIPT = [
    'on run argv',
    'tell application "Messages"',
    'set targetService to 1st account whose service type = iMessage',
    'set targetBuddy to participant (item 1 of argv) of targetService',
    'send (item 2 of argv) to targetBuddy',
    'end tell',
    'end run',
];
export class MessagesDatabase {
    /** Replaced in tests: where the database is and how osascript runs. */
    path = MESSAGES_DB;
    run = run;
    sent = [];
    open() {
        try {
            return new DatabaseSync(this.path, { readOnly: true });
        }
        catch (error) {
            // Without Full Disk Access macOS refuses to open it at all.
            throw Object.assign(new Error('IMESSAGE_NO_ACCESS'), { cause: error });
        }
    }
    /** The newest message now, so receiving starts from here and not from years of history. */
    latest() {
        const db = this.open();
        try {
            return Number(db.prepare('SELECT MAX(ROWID) AS rowid FROM message').get().rowid ?? 0);
        }
        finally {
            db.close();
        }
    }
    /** The handle is one of this Mac's own iMessage accounts (messages record theirs as "E:…" or "P:…"). */
    ownAccount(handle) {
        const db = this.open();
        try {
            const accounts = db.prepare('SELECT DISTINCT account FROM message WHERE account IS NOT NULL LIMIT 50').all();
            return accounts.some(row => sameHandle(row.account.replace(/^[EePp]:/, ''), handle));
        }
        finally {
            db.close();
        }
    }
    /** Messages after `after` in one-to-one chats, oldest first. */
    read(after) {
        const db = this.open();
        try {
            return db.prepare(`SELECT m.ROWID AS rowid, m.text AS text, m.attributedBody AS body, m.is_from_me AS mine, h.id AS sender,
          c.chat_identifier AS chat, c.style AS style
        FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join j ON j.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = j.chat_id
        WHERE m.ROWID > ? ORDER BY m.ROWID LIMIT 200`).all(after);
        }
        finally {
            db.close();
        }
    }
    /** Something we sent lately, so it is not read back as the user's own message in a chat with oneself. */
    sentRecently(text, now = Date.now()) {
        while (this.sent.length && now - this.sent[0].at > SENT_REMEMBERED_MS)
            this.sent.shift();
        return this.sent.some(item => item.text === text.trim());
    }
    async send(handle, text) {
        this.sent.push({ text: text.trim(), at: Date.now() });
        await this.run('osascript', [...SEND_SCRIPT.flatMap(line => ['-e', line]), handle, text]);
    }
}
/** Reading new rows: the owner's messages in their one-to-one chat; style 45 is a one-to-one chat, 43 a group. */
export function imessageSource(db, now = Date.now) {
    // Texting oneself, Messages may log a sent and a received copy of the same message: deliver it once.
    let lastSelf;
    return {
        timeoutMs: 0,
        intervalMs: INTERVAL_MS,
        identity: saved => saved.handle,
        label: saved => saved.handle,
        poll: async (saved) => {
            let rows;
            try {
                rows = db.read(Number(saved.cursor) || 0);
            }
            catch (error) {
                return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
            }
            const messages = rows.flatMap(row => {
                if (row.style === 43)
                    return [];
                const text = (row.text ?? attributedText(row.body)).trim();
                if (!saved.self)
                    return !row.mine && !!row.sender && sameHandle(row.sender, saved.handle) ? [{ id: String(row.rowid), text }] : [];
                // Texting oneself: every message in that chat is the user's or ours; ours are told apart by what we sent.
                if (!row.chat || !sameHandle(row.chat, saved.handle) || db.sentRecently(text))
                    return [];
                const at = now();
                if (lastSelf && lastSelf.text === text && at - lastSelf.at < 15_000)
                    return [];
                lastSelf = { text, at };
                return [{ id: String(row.rowid), text }];
            });
            return { kind: 'ok', messages, cursor: rows.length ? String(rows.at(-1).rowid) : saved.cursor };
        },
    };
}
export class IMessageLink extends RemoteLink {
    db;
    platform;
    constructor(db, deps, platform = process.platform) {
        super({ ...deps, source: imessageSource(db) });
        this.db = db;
        this.platform = platform;
    }
    status() {
        return { ...super.status(), supported: this.platform === 'darwin' };
    }
    /** Listen to `handle` from the newest message on. */
    async connect(handle) {
        if (this.platform !== 'darwin')
            throw new Error('IMESSAGE_UNSUPPORTED');
        const trimmed = handle.trim();
        if (!HANDLE_PATTERN.test(trimmed))
            throw new Error('IMESSAGE_HANDLE_INVALID');
        const cursor = String(this.db.latest());
        await this.bind({ handle: trimmed, self: this.db.ownAccount(trimmed), enabled: true, cursor });
    }
}
