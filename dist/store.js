import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Stores descriptors and routing metadata. Original conversation stays in DSH. */
export class ContextStore {
    db;
    constructor(path) {
        if (path !== ':memory:')
            mkdirSync(dirname(path), { recursive: true });
        this.db = new DatabaseSync(path);
        this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS contexts (
        id TEXT PRIMARY KEY, descriptor TEXT NOT NULL, working_session_id TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS context_sources (
        context_id TEXT NOT NULL REFERENCES contexts(id), session_id TEXT NOT NULL,
        PRIMARY KEY(context_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS context_source_ranges (
        context_id TEXT NOT NULL REFERENCES contexts(id), session_id TEXT NOT NULL,
        start_seq INTEGER NOT NULL, end_seq INTEGER NOT NULL,
        PRIMARY KEY(context_id, session_id, start_seq, end_seq)
      );
      CREATE TABLE IF NOT EXISTS gateway_state (
        gateway_key TEXT PRIMARY KEY, context_id TEXT NOT NULL REFERENCES contexts(id)
      );
      CREATE TABLE IF NOT EXISTS context_state_updates (
        id INTEGER PRIMARY KEY, context_id TEXT NOT NULL REFERENCES contexts(id),
        session_id TEXT NOT NULL, through_seq INTEGER NOT NULL, state TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS context_summary_updates (
        context_id TEXT NOT NULL REFERENCES contexts(id), session_id TEXT NOT NULL,
        summary_seq INTEGER NOT NULL, end_seq INTEGER NOT NULL, summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(context_id, session_id, summary_seq)
      );
      CREATE TABLE IF NOT EXISTS routing_events (
        message_id TEXT PRIMARY KEY, gateway_id TEXT NOT NULL, decision TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS gateway_sessions (
        gateway_key TEXT NOT NULL, gateway_id TEXT NOT NULL,
        PRIMARY KEY(gateway_key, gateway_id)
      );
    `);
    }
    seed(contexts) {
        for (const context of contexts) {
            this.db.prepare('INSERT OR IGNORE INTO contexts VALUES (?, ?, ?)')
                .run(context.id, JSON.stringify(context), randomUUID());
        }
    }
    contexts() {
        return this.db.prepare('SELECT * FROM contexts ORDER BY id').all().map(row => ({
            ...JSON.parse(String(row.descriptor)),
            workingSessionId: String(row.working_session_id),
        }));
    }
    current(gatewayKey) {
        const row = this.db.prepare('SELECT context_id FROM gateway_state WHERE gateway_key = ?').get(gatewayKey);
        return row ? String(row.context_id) : undefined;
    }
    /** Model-maintained progress is bounded and auditable; stable project identity remains unchanged. */
    updateState(contextId, state, sessionId, throughSeq) {
        const context = this.contexts().find(item => item.id === contextId);
        if (!context || context.workingSessionId !== sessionId)
            throw new Error('State requires the owned Worker');
        if (!state.trim() || state.length > 800 || !Number.isSafeInteger(throughSeq) || throughSeq < 0)
            throw new Error('Invalid project state');
        if (/\bsk-[a-zA-Z0-9_-]{16,}|\bBearer\s+\S+|(?:api[_ -]?key|password|密码|密钥)\s*[:=：]\s*\S+/i.test(state))
            throw new Error('Project state must not contain credentials');
        const { workingSessionId: _, ...descriptor } = context;
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?').run(JSON.stringify({ ...descriptor, lastState: state.trim() }), contextId);
            this.db.prepare('INSERT INTO context_state_updates(context_id, session_id, through_seq, state) VALUES (?, ?, ?, ?)')
                .run(contextId, sessionId, throughSeq, state.trim());
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    stateUpdates(contextId) {
        return this.db.prepare('SELECT session_id AS sessionId, through_seq AS throughSeq, state, created_at AS createdAt FROM context_state_updates WHERE context_id = ? ORDER BY id').all(contextId);
    }
    /** Reuse a completed DSH compaction checkpoint once, without another model call. */
    updateSummary(contextId, summary, sessionId, summarySeq, endSeq) {
        const context = this.contexts().find(item => item.id === contextId);
        if (!context || context.workingSessionId !== sessionId)
            throw new Error('Summary requires the owned Worker');
        if (!summary.trim() || summary.length > 1200 || !Number.isSafeInteger(summarySeq) || summarySeq < 0 || !Number.isSafeInteger(endSeq) || endSeq <= summarySeq)
            throw new Error('Invalid compaction reference');
        const { workingSessionId: _, ...descriptor } = context;
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const inserted = this.db.prepare('INSERT OR IGNORE INTO context_summary_updates(context_id, session_id, summary_seq, end_seq, summary) VALUES (?, ?, ?, ?, ?)')
                .run(contextId, sessionId, summarySeq, endSeq, summary.trim());
            if (inserted.changes)
                this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?')
                    .run(JSON.stringify({ ...descriptor, summary: summary.trim() }), contextId);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    summaryUpdates(contextId) {
        return this.db.prepare('SELECT session_id AS sessionId, summary_seq AS summarySeq, end_seq AS endSeq, summary FROM context_summary_updates WHERE context_id = ? ORDER BY rowid').all(contextId);
    }
    route(messageId) {
        const row = this.db.prepare('SELECT * FROM routing_events WHERE message_id = ?').get(messageId);
        return row ? {
            messageId: String(row.message_id), gatewayId: String(row.gateway_id),
            decision: JSON.parse(String(row.decision)),
            status: String(row.status),
        } : undefined;
    }
    recentGatewayIds(gatewayKey, excludingId) {
        return this.db.prepare(`SELECT gs.gateway_id FROM gateway_sessions gs
      JOIN routing_events r ON r.gateway_id = gs.gateway_id
      WHERE gs.gateway_key = ? AND gs.gateway_id != ? AND r.status = 'completed'
      GROUP BY gs.gateway_id ORDER BY MAX(r.rowid) DESC LIMIT 2`)
            .all(gatewayKey, excludingId).map(row => String(row.gateway_id));
    }
    /** Idempotent planning reserves a worker ID before any DSH creation. */
    plan(messageId, gatewayId, gatewayKey, proposed) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const existing = this.route(messageId);
            if (existing) {
                this.db.exec('COMMIT');
                return existing;
            }
            let decision = { ...proposed };
            if (decision.action === 'CREATE') {
                const context = {
                    id: randomUUID(), title: decision.title, summary: '新话题，尚无历史摘要。',
                    entities: [], keywords: [decision.title], lastState: '等待首次执行',
                };
                this.seed([context]);
                decision = { ...decision, contextId: context.id };
            }
            if (decision.contextId) {
                this.db.prepare('INSERT INTO gateway_state VALUES (?, ?) ON CONFLICT(gateway_key) DO UPDATE SET context_id = excluded.context_id')
                    .run(gatewayKey, decision.contextId);
            }
            this.db.prepare('INSERT INTO routing_events(message_id, gateway_id, decision, status) VALUES (?, ?, ?, ?)')
                .run(messageId, gatewayId, JSON.stringify(decision), 'planned');
            this.db.prepare('INSERT OR IGNORE INTO gateway_sessions VALUES (?, ?)').run(gatewayKey, gatewayId);
            this.db.exec('COMMIT');
            return { messageId, gatewayId, decision, status: 'planned' };
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    /** Only a planned route may execute. Ambiguous interrupted work is never replayed automatically. */
    claim(messageId) {
        const result = this.db.prepare("UPDATE routing_events SET status = 'running' WHERE message_id = ? AND status = 'planned'").run(messageId);
        if (result.changes !== 1)
            throw new Error('This input has already started. Inspect its DSH session before resubmitting; automatic replay is disabled.');
    }
    finish(messageId, status) {
        this.db.prepare('UPDATE routing_events SET status = ? WHERE message_id = ?').run(status, messageId);
    }
    /** Whole-session access is allowed only for this Context's dedicated worker. */
    addSource(contextId, sessionId, range) {
        const context = this.contexts().find(item => item.id === contextId);
        if (!context)
            throw new Error('Unknown Context');
        if (range) {
            if (!Number.isSafeInteger(range.startSeq) || !Number.isSafeInteger(range.endSeq) ||
                range.startSeq < 0 || range.endSeq < range.startSeq)
                throw new Error('Invalid history event range');
            this.db.prepare('INSERT OR IGNORE INTO context_source_ranges VALUES (?, ?, ?, ?)')
                .run(contextId, sessionId, range.startSeq, range.endSeq);
        }
        else {
            if (sessionId !== context.workingSessionId)
                throw new Error('Historical sources require an explicit event range');
            this.db.prepare('INSERT OR IGNORE INTO context_sources VALUES (?, ?)').run(contextId, sessionId);
        }
    }
    /** Old unscoped historical mappings remain visible, but cannot be searched. */
    sourceRanges(contextId) {
        const worker = this.contexts().find(item => item.id === contextId)?.workingSessionId;
        const ranges = this.db.prepare('SELECT * FROM context_source_ranges WHERE context_id = ? ORDER BY session_id, start_seq')
            .all(contextId).map(row => ({ sessionId: String(row.session_id), kind: 'bounded', startSeq: Number(row.start_seq), endSeq: Number(row.end_seq) }));
        for (const row of this.db.prepare('SELECT session_id FROM context_sources WHERE context_id = ? ORDER BY session_id').all(contextId)) {
            const sessionId = String(row.session_id);
            if (ranges.some(range => range.sessionId === sessionId))
                continue;
            ranges.push({ sessionId, kind: sessionId === worker ? 'worker' : 'unscoped' });
        }
        return ranges;
    }
    sources(contextId) {
        return [...new Set(this.sourceRanges(contextId).map(source => source.sessionId))];
    }
    close() { this.db.close(); }
}
