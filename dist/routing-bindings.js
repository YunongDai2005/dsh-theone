import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { uniqueSources } from "./learning-journal.js";
/** Server-owned provenance, separate from optional shadow observations. No text or grants.
 * Pending requests expire on runtime restart: an old UI answer must never revive a closed wait.
 * Registration is a trusted in-process producer seam; HTTP clients can only reference records.
 */
export class RoutingBindings {
    gateway;
    valid;
    db;
    runtime = randomUUID();
    constructor(path, gateway, valid) {
        this.gateway = gateway;
        this.valid = valid;
        this.db = new DatabaseSync(path);
        this.db.exec('PRAGMA busy_timeout=100; CREATE TABLE IF NOT EXISTS routing_refs (' +
            'n INTEGER PRIMARY KEY, gateway TEXT, id TEXT, topic TEXT, kind TEXT, origin TEXT, value TEXT, runtime TEXT, closed INTEGER DEFAULT 0,' +
            'UNIQUE(gateway,id,topic)); CREATE INDEX IF NOT EXISTS routing_refs_recent ON routing_refs(gateway,origin,n);' +
            'CREATE TABLE IF NOT EXISTS routing_inputs (gateway TEXT, session TEXT, message TEXT, value TEXT, PRIMARY KEY(gateway,session,message));');
    }
    close() { this.db.close(); }
    record(reference) {
        this.db.prepare('INSERT OR IGNORE INTO routing_refs(gateway,id,topic,kind,origin,value,runtime) VALUES (?,?,?,?,?,?,?)')
            .run(this.gateway, reference.id, reference.topicId, reference.kind, reference.source, JSON.stringify(reference), reference.kind === 'reply' ? null : this.runtime);
    }
    closeReference(id) {
        this.db.prepare('UPDATE routing_refs SET closed=1 WHERE gateway=? AND id=?').run(this.gateway, id);
    }
    rememberInput(session, message, input) {
        this.db.prepare('INSERT OR IGNORE INTO routing_inputs VALUES (?,?,?,?)').run(this.gateway, session, message, JSON.stringify(input));
    }
    input(session, message) {
        const row = this.db.prepare('SELECT value FROM routing_inputs WHERE gateway=? AND session=? AND message=?').get(this.gateway, session, message);
        return row ? JSON.parse(String(row.value)) : {};
    }
    resolve(input, topics, steering) {
        const refs = [], owners = [];
        const rejected = (reason) => ({ status: 'rejected', refs, reason });
        for (const [key, id] of Object.entries(input)) {
            refs.push(id);
            if (key === 'steeringOf') {
                if (!steering || steering.inputId !== id || !topics.has(steering.topicId) || !this.valid(steering.sources))
                    return rejected('stale-steering');
                owners.push({ ...steering, kind: 'steering' });
                continue;
            }
            const rows = this.db.prepare('SELECT value,runtime,closed FROM routing_refs WHERE gateway=? AND id=?').all(this.gateway, id);
            if (rows.length !== 1)
                return rejected(rows.length ? 'conflicting-owners' : 'unknown-reference');
            const row = rows[0], ref = JSON.parse(String(row.value));
            if (row.closed || row.runtime && row.runtime !== this.runtime)
                return rejected('expired-reference');
            if (ref.source !== 'foreground')
                return rejected('unreliable-source');
            if (key === 'replyTo' ? ref.kind !== 'reply' : key !== 'pendingResponse' || ref.kind === 'reply')
                return rejected('reference-kind');
            if (!topics.has(ref.topicId) || !this.valid(ref.sources))
                return rejected('invalid-target');
            owners.push(ref);
        }
        if (!owners.length)
            return { status: 'none' };
        if (new Set(owners.map(owner => owner.topicId)).size !== 1)
            return rejected('conflicting-owners');
        return { status: 'applied', kind: owners.at(-1).kind, topicId: owners[0].topicId, refs,
            sources: uniqueSources(owners.flatMap(owner => owner.sources)) };
    }
    /** Bounded reads; learning validity uses LearningJournal's existing stage cache. */
    attention(topics) {
        const latest = (source, limit) => this.db.prepare('SELECT value FROM routing_refs WHERE gateway=? AND origin=? AND kind=? ORDER BY n DESC LIMIT 32')
            .all(this.gateway, source, 'reply').map(row => JSON.parse(String(row.value)))
            .filter(ref => topics.has(ref.topicId) && this.valid(ref.sources)).slice(0, limit)
            .map(ref => ({ messageId: ref.id, topicId: ref.topicId }));
        const foreground = latest('foreground', 1)[0], background = latest('background', 3);
        return foreground || background.length ? { ...(foreground ? { foreground } : {}), background } : undefined;
    }
    references(topics) {
        return this.db.prepare('SELECT value FROM routing_refs WHERE gateway=? ORDER BY n DESC LIMIT 64').all(this.gateway)
            .map(row => JSON.parse(String(row.value)))
            .filter(ref => this.resolve(ref.kind === 'reply' ? { replyTo: ref.id } : { pendingResponse: ref.id }, topics).status === 'applied');
    }
}
export function parseBindingInput(value) {
    if (value === undefined)
        return {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid binding');
    const input = {};
    for (const [key, id] of Object.entries(value)) {
        if (!['replyTo', 'pendingResponse', 'steeringOf'].includes(key) || typeof id !== 'string' || !id.trim() || id.length > 300)
            throw new Error('Invalid binding reference');
        input[key] = id;
    }
    return input;
}
