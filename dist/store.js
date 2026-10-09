import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { FACT_KINDS, FACT_LIMITS, factKey, safe } from "./facts.js";
/** Terms learned from corrections fade by half every 30 days unless they are confirmed again. */
export const TERM_HALF_LIFE_MS = 30 * 86400000;
/** A whole session attached by hand counts as reviewed from its first event to its last. */
export const WHOLE_SESSION = { startSeq: 0, endSeq: Number.MAX_SAFE_INTEGER };
/** Stores descriptors and routing metadata. Original conversation stays in DSH. */
export class ContextStore {
    db;
    constructor(path) {
        if (path !== ':memory:')
            mkdirSync(dirname(path), { recursive: true });
        this.db = new DatabaseSync(path);
        this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS topic_groups (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, normalized_title TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS topic_group_members (
        context_id TEXT PRIMARY KEY REFERENCES contexts(id), group_id TEXT NOT NULL REFERENCES topic_groups(id)
      );
      CREATE TABLE IF NOT EXISTS history_index (
        session_id TEXT PRIMARY KEY, through_seq INTEGER NOT NULL, status TEXT NOT NULL, error_code TEXT
      );
      CREATE TABLE IF NOT EXISTS history_turns (
        session_id TEXT NOT NULL, user_seq INTEGER NOT NULL, end_seq INTEGER NOT NULL,
        fingerprint TEXT NOT NULL, context_id TEXT NOT NULL REFERENCES contexts(id),
        PRIMARY KEY(session_id, user_seq)
      );
      CREATE TABLE IF NOT EXISTS context_origins (
        context_id TEXT PRIMARY KEY REFERENCES contexts(id), session_id TEXT NOT NULL, cwd TEXT
      );
      CREATE TABLE IF NOT EXISTS model_binding (
        gateway_key TEXT PRIMARY KEY, selection TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plugin_settings (
        gateway_key TEXT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL
      );
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
      CREATE TABLE IF NOT EXISTS pinned_gateways (gateway_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS topic_links (
        a TEXT NOT NULL, b TEXT NOT NULL, weight REAL NOT NULL DEFAULT 0,
        manual INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(a, b)
      );
      CREATE TABLE IF NOT EXISTS topic_flags (
        context_id TEXT PRIMARY KEY, private INTEGER NOT NULL DEFAULT 0, constraints TEXT, constraints_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS compaction_digests (
        context_id TEXT PRIMARY KEY, summary TEXT NOT NULL, through_seq INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS briefing_seen (
        reader TEXT NOT NULL, source TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY(reader, source)
      );
      CREATE TABLE IF NOT EXISTS dismissed_turns (
        session_id TEXT NOT NULL, user_seq INTEGER NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(session_id, user_seq)
      );
      CREATE TABLE IF NOT EXISTS learned_terms (
        context_id TEXT NOT NULL, term TEXT NOT NULL, weight REAL NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(context_id, term)
      );
      CREATE TABLE IF NOT EXISTS dismissed_notices (id TEXT PRIMARY KEY, dismissed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_flags (name TEXT PRIMARY KEY, set_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stowed_sessions (session_id TEXT PRIMARY KEY, stowed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS route_details (
        message_id TEXT PRIMARY KEY, excerpt TEXT NOT NULL, receipt TEXT, corrected_to TEXT, corrected_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY, context_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]', kind TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'artifact')),
        current_version INTEGER NOT NULL, merged_from TEXT, deleted_at INTEGER, last_used_at INTEGER,
        UNIQUE (context_id, key)
      );
      CREATE TABLE IF NOT EXISTS fact_versions (
        fact_id TEXT NOT NULL REFERENCES facts(id), version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('confirmed', 'proposed', 'retracted')),
        value TEXT, evidence TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('worker', 'extractor')),
        created_at INTEGER NOT NULL, PRIMARY KEY (fact_id, version)
      );
      CREATE TABLE IF NOT EXISTS fact_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, context_id TEXT NOT NULL, fact_id TEXT NOT NULL, version INTEGER NOT NULL,
        input_id TEXT, via TEXT NOT NULL CHECK (via IN ('route', 'lookup', 'notice')), at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fact_dependencies (
        context_id TEXT NOT NULL, fact_id TEXT NOT NULL, version_seen INTEGER NOT NULL,
        first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (context_id, fact_id)
      );
      CREATE TABLE IF NOT EXISTS hidden_contexts (
        context_id TEXT PRIMARY KEY REFERENCES contexts(id), reason TEXT NOT NULL, detected_at INTEGER NOT NULL
      );
    `);
    }
    settings(gatewayKey) {
        const row = this.db.prepare('SELECT settings, revision FROM plugin_settings WHERE gateway_key = ?').get(gatewayKey);
        if (!row)
            return;
        let values;
        try {
            values = JSON.parse(row.settings);
        }
        catch { /* A fresh save can repair malformed preferences. */ }
        return { values, revision: row.revision };
    }
    saveSettings(gatewayKey, values, revision) {
        const result = this.db.prepare(`INSERT INTO plugin_settings(gateway_key, settings, revision)
      SELECT ?, ?, 1 WHERE ? = 0 OR EXISTS(SELECT 1 FROM plugin_settings WHERE gateway_key = ? AND revision = ?)
      ON CONFLICT(gateway_key) DO UPDATE SET settings = excluded.settings, revision = plugin_settings.revision + 1
      WHERE plugin_settings.revision = ?`).run(gatewayKey, JSON.stringify(values), revision, gatewayKey, revision, revision);
        return result.changes === 1;
    }
    /** Only model identity is persisted. API credentials remain owned by DSH. */
    rememberModel(gatewayKey, selection) {
        if (!selection.provider || !selection.model || selection.provider === 'theone')
            throw new Error('Invalid backing model');
        const value = { provider: selection.provider, model: selection.model,
            ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}) };
        this.db.prepare('INSERT OR REPLACE INTO model_binding VALUES (?, ?)').run(gatewayKey, JSON.stringify(value));
    }
    rememberedModel(gatewayKey) {
        const row = this.db.prepare('SELECT selection FROM model_binding WHERE gateway_key = ?').get(gatewayKey);
        return row ? JSON.parse(String(row.selection)) : undefined;
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
    /** Context ids, newest first. contexts() is ordered by id, and generated ids are random. */
    contextIdsByRecency() {
        return this.db.prepare('SELECT id FROM contexts ORDER BY rowid DESC').all().map(row => String(row.id));
    }
    current(gatewayKey) {
        const row = this.db.prepare('SELECT context_id FROM gateway_state WHERE gateway_key = ?').get(gatewayKey);
        return row ? String(row.context_id) : undefined;
    }
    /** Successful uses only: retries, failed work and clarification never heat a topic. */
    contextUsage(gatewayKey, now = Date.now()) {
        const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
        return this.db.prepare(`SELECT json_extract(r.decision, '$.contextId') AS context_id,
      COUNT(*) AS calls, SUM(r.created_at >= ?) AS recent_calls, MAX(r.created_at) AS last_used
      FROM routing_events r JOIN gateway_sessions gs ON gs.gateway_id = r.gateway_id
      WHERE gs.gateway_key = ? AND r.status = 'completed'
        AND json_extract(r.decision, '$.action') != 'CLARIFY'
        AND json_extract(r.decision, '$.contextId') IS NOT NULL
      GROUP BY context_id`).all(cutoff, gatewayKey).map(row => ({
            contextId: String(row.context_id), completedCalls: Number(row.calls),
            recentCalls: Number(row.recent_calls), lastUsedAt: Date.parse(String(row.last_used).replace(' ', 'T') + 'Z'),
        }));
    }
    /** Every completed route of this entry, oldest first, to the topic it really belonged to (after corrections). */
    routeTimeline(gatewayKey) {
        return this.db.prepare(`SELECT COALESCE(d.corrected_to, json_extract(r.decision, '$.contextId')) AS context_id, r.created_at
      FROM routing_events r JOIN gateway_sessions gs ON gs.gateway_id = r.gateway_id
      LEFT JOIN route_details d ON d.message_id = r.message_id
      WHERE gs.gateway_key = ? AND r.status = 'completed' AND json_extract(r.decision, '$.action') != 'CLARIFY'
      ORDER BY r.rowid`).all(gatewayKey).flatMap(row => row.context_id == null ? [] : [{
                contextId: String(row.context_id), at: Date.parse(String(row.created_at).replace(' ', 'T') + 'Z')
            }]);
    }
    /**
     * A topic's routing card: other names and entities join its keywords, and its summary is replaced
     * unless a compaction summary (written from the whole session) already took its place.
     */
    applyCard(contextId, card) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const context = this.contexts().find(item => item.id === contextId);
            if (!context) {
                this.db.exec('COMMIT');
                return;
            }
            const { workingSessionId: _, ...descriptor } = context;
            const merge = (first, then) => {
                const seen = new Set();
                return [...first, ...then].filter(term => { const key = term.toLowerCase(); return term && !seen.has(key) && seen.add(key); }).slice(0, 24);
            };
            const compacted = this.summaryUpdates(contextId).length > 0;
            const summary = compacted ? descriptor.summary : [card.summary, card.open.length ? `待定：${card.open.join('；')}` : ''].filter(Boolean).join(' ').slice(0, 600);
            this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?').run(JSON.stringify({ ...descriptor, summary,
                keywords: merge(descriptor.keywords, card.aliases), entities: merge(card.entities, descriptor.entities) }), contextId);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    groups() {
        return this.db.prepare('SELECT * FROM topic_groups ORDER BY title').all().map(row => ({
            id: String(row.id), title: String(row.title), summary: String(row.summary),
            contextIds: this.db.prepare('SELECT context_id FROM topic_group_members WHERE group_id = ? ORDER BY context_id').all(String(row.id)).map(r => String(r.context_id)),
        })).filter(group => group.contextIds.length > 0);
    }
    isGateway(sessionId) {
        return !!this.db.prepare('SELECT 1 FROM gateway_sessions WHERE gateway_id = ? LIMIT 1').get(sessionId);
    }
    /** Record the fixed "TheOne · Main chat" entry; other sessions may also use TheOne and switch away. */
    rememberGateway(gatewayKey, sessionId) {
        this.db.prepare('INSERT OR IGNORE INTO gateway_sessions VALUES (?, ?)').run(gatewayKey, sessionId);
        this.db.prepare('INSERT OR IGNORE INTO pinned_gateways VALUES (?)').run(sessionId);
    }
    /**
     * Sessions TheOne made for itself: every fixed main chat and each topic's background session.
     * Sessions the user made, including ones that once chose TheOne as their model, are not among them.
     */
    ownedSessionIds() {
        return this.db.prepare('SELECT gateway_id AS id FROM pinned_gateways UNION SELECT working_session_id AS id FROM contexts').all().map(row => String(row.id));
    }
    /** TheOne's own sessions it put in DSH's archive when it stopped; only these are taken out again. */
    stowedSessionIds() {
        return this.db.prepare('SELECT session_id FROM stowed_sessions').all().map(row => String(row.session_id));
    }
    markStowed(sessionId, stowed, now = Date.now()) {
        if (stowed)
            this.db.prepare('INSERT OR REPLACE INTO stowed_sessions VALUES (?, ?)').run(sessionId, now);
        else
            this.db.prepare('DELETE FROM stowed_sessions WHERE session_id = ?').run(sessionId);
    }
    isPinnedGateway(sessionId) {
        return !!this.db.prepare('SELECT 1 FROM pinned_gateways WHERE gateway_id = ?').get(sessionId);
    }
    origin(contextId) {
        const row = this.db.prepare('SELECT * FROM context_origins WHERE context_id = ?').get(contextId);
        return row ? { sessionId: String(row.session_id), ...(row.cwd ? { cwd: String(row.cwd) } : {}) } : undefined;
    }
    indexState(sessionId) {
        const row = this.db.prepare('SELECT * FROM history_index WHERE session_id = ?').get(sessionId);
        return row ? { throughSeq: Number(row.through_seq), status: String(row.status) } : undefined;
    }
    markIndex(sessionId, throughSeq, status, errorCode) {
        this.db.prepare('INSERT OR REPLACE INTO history_index VALUES (?, ?, ?, ?)').run(sessionId, throughSeq, status, errorCode ?? null);
    }
    /** A turn of a topic the user deleted; the catalog must not extract it again while it is unchanged. */
    dismissedTurn(sessionId, seq) {
        const row = this.db.prepare('SELECT fingerprint FROM dismissed_turns WHERE session_id = ? AND user_seq = ?').get(sessionId, seq);
        return row ? String(row.fingerprint) : undefined;
    }
    indexedTurn(sessionId, seq) {
        const row = this.db.prepare('SELECT fingerprint, context_id FROM history_turns WHERE session_id = ? AND user_seq = ?').get(sessionId, seq);
        return row ? { fingerprint: String(row.fingerprint), contextId: String(row.context_id) } : undefined;
    }
    /** One validated batch commits descriptors, groups and exact source ranges atomically. */
    importTopics(sessionId, cwd, parts, topics) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const topic of topics) {
                const id = topic.contextId ?? randomUUID();
                const existing = this.contexts().find(context => context.id === id);
                // The Worker's own progress note and DSH compaction summary outrank a catalog re-extraction, which only
                // sees short excerpts; otherwise every re-index after a turn would overwrite them.
                const stated = existing && this.db.prepare('SELECT 1 FROM context_state_updates WHERE context_id = ? LIMIT 1').get(id);
                const summarized = existing && this.db.prepare('SELECT 1 FROM context_summary_updates WHERE context_id = ? LIMIT 1').get(id);
                const descriptor = { id, title: existing?.title ?? topic.title,
                    summary: summarized ? existing.summary : topic.summary, entities: topic.entities, keywords: topic.keywords,
                    lastState: stated ? existing.lastState : topic.lastState };
                if (existing)
                    this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?').run(JSON.stringify(descriptor), id);
                else {
                    this.seed([descriptor]);
                    this.db.prepare('INSERT INTO context_origins VALUES (?, ?, ?)').run(id, sessionId, cwd ?? null);
                }
                let groupId = topic.groupId;
                if (!groupId) {
                    const title = topic.groupTitle || '待归类';
                    const normalized = title.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
                    groupId = 'group-' + createHash('sha256').update(normalized).digest('hex').slice(0, 20);
                    this.db.prepare('INSERT OR IGNORE INTO topic_groups VALUES (?, ?, ?, ?)').run(groupId, title, topic.groupSummary, normalized);
                }
                this.db.prepare('INSERT OR REPLACE INTO topic_group_members VALUES (?, ?)').run(id, groupId);
                for (const seq of topic.turns) {
                    const part = parts.find(part => part.seq === seq);
                    const old = this.db.prepare('SELECT * FROM history_turns WHERE session_id = ? AND user_seq = ?').get(sessionId, seq);
                    if (old)
                        this.db.prepare('DELETE FROM context_source_ranges WHERE context_id = ? AND session_id = ? AND start_seq = ? AND end_seq = ?')
                            .run(String(old.context_id), sessionId, seq, Number(old.end_seq));
                    this.addSource(id, sessionId, { startSeq: seq, endSeq: part.endSeq });
                    this.db.prepare('INSERT OR REPLACE INTO history_turns VALUES (?, ?, ?, ?, ?)').run(sessionId, seq, part.endSeq, part.fingerprint, id);
                }
            }
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    mount(gatewayKey, contextId) {
        if (!this.contexts().some(context => context.id === contextId))
            throw new Error('Unknown Context');
        this.db.prepare('INSERT INTO gateway_state VALUES (?, ?) ON CONFLICT(gateway_key) DO UPDATE SET context_id = excluded.context_id').run(gatewayKey, contextId);
    }
    contextsForSessions(sessionIds) {
        const wanted = new Set(sessionIds);
        return this.contexts().filter(context => wanted.has(context.workingSessionId) || this.sources(context.id).some(id => wanted.has(id))).map(context => context.id);
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
    /** Learned relatedness halves every two weeks without new evidence. */
    static LINK_HALF_LIFE_MS = 14 * 86400000;
    pair(a, b) { return a < b ? [a, b] : [b, a]; }
    /** Link rows touching one topic (or all), with learned weight decayed to `now`. */
    links(contextId, now = Date.now()) {
        const rows = contextId === undefined ? this.db.prepare('SELECT * FROM topic_links').all()
            : this.db.prepare('SELECT * FROM topic_links WHERE a = ? OR b = ?').all(contextId, contextId);
        return rows.map(row => ({ a: String(row.a), b: String(row.b), manual: Number(row.manual),
            weight: Number(row.weight) * 0.5 ** (Math.max(0, now - Number(row.updated_at)) / ContextStore.LINK_HALF_LIFE_MS) }));
    }
    /** Add learned evidence; a pair the user unlinked never learns back. */
    learnLink(a, b, delta, now = Date.now()) {
        if (a === b)
            return;
        const [x, y] = this.pair(a, b);
        const existing = this.links(x, now).find(link => link.a === x && link.b === y);
        if (existing?.manual === -1)
            return;
        const weight = Math.min(5, Math.max(0, (existing?.weight ?? 0) + delta));
        this.db.prepare(`INSERT INTO topic_links(a, b, weight, manual, updated_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(a, b) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`).run(x, y, weight, now);
    }
    /** 1 links a pair permanently, -1 keeps it apart, 0 returns it to learning. */
    setManualLink(a, b, manual, now = Date.now()) {
        if (a === b)
            throw new Error('A topic cannot link to itself');
        const [x, y] = this.pair(a, b);
        this.db.prepare(`INSERT INTO topic_links(a, b, weight, manual, updated_at) VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(a, b) DO UPDATE SET manual = excluded.manual, weight = CASE WHEN excluded.manual = -1 THEN 0 ELSE topic_links.weight END`).run(x, y, manual, now);
    }
    /** Forget learned relatedness; the user's own links and separations stay. */
    clearLearnedLinks() {
        this.db.exec('DELETE FROM topic_links WHERE manual = 0; UPDATE topic_links SET weight = 0');
    }
    setPrivate(contextId, value) {
        this.db.prepare(`INSERT INTO topic_flags(context_id, private) VALUES (?, ?)
      ON CONFLICT(context_id) DO UPDATE SET private = excluded.private`).run(contextId, value ? 1 : 0);
    }
    privateIds() {
        return new Set(this.db.prepare('SELECT context_id FROM topic_flags WHERE private = 1').all().map(row => String(row.context_id)));
    }
    /** Project directory of every topic that came from an existing session. */
    origins() {
        return new Map(this.db.prepare('SELECT context_id, cwd FROM context_origins').all().map(row => [String(row.context_id), row.cwd ? String(row.cwd) : undefined]));
    }
    isPrivate(contextId) {
        return !!this.db.prepare('SELECT 1 FROM topic_flags WHERE context_id = ? AND private = 1').get(contextId);
    }
    /** Standing rules for a topic, kept apart from summaries so compaction cannot drop them. */
    setConstraints(contextId, text, now = Date.now()) {
        const value = text?.trim() || null;
        if (value && (value.length > 400 || /\bsk-[a-zA-Z0-9_-]{16,}|\bBearer\s+\S+/i.test(value)))
            throw new Error('Invalid topic constraints');
        this.db.prepare(`INSERT INTO topic_flags(context_id, constraints, constraints_at) VALUES (?, ?, ?)
      ON CONFLICT(context_id) DO UPDATE SET constraints = excluded.constraints, constraints_at = excluded.constraints_at`).run(contextId, value, now);
    }
    constraints(contextId) {
        const row = this.db.prepare('SELECT constraints, constraints_at FROM topic_flags WHERE context_id = ? AND constraints IS NOT NULL').get(contextId);
        return row ? { text: String(row.constraints), at: Number(row.constraints_at) } : undefined;
    }
    /** The latest full compaction summary of a topic's Worker and how far it covers. */
    saveDigest(contextId, summary, throughSeq, now = Date.now()) {
        this.db.prepare(`INSERT INTO compaction_digests VALUES (?, ?, ?, ?) ON CONFLICT(context_id) DO UPDATE SET
      summary = excluded.summary, through_seq = excluded.through_seq, created_at = excluded.created_at
      WHERE excluded.through_seq > compaction_digests.through_seq`).run(contextId, summary.slice(0, 16000), throughSeq, now);
    }
    digest(contextId) {
        const row = this.db.prepare('SELECT * FROM compaction_digests WHERE context_id = ?').get(contextId);
        return row ? { summary: String(row.summary), throughSeq: Number(row.through_seq), at: Number(row.created_at) } : undefined;
    }
    /** When `reader` last received `source`'s state in a briefing. */
    seen(reader, source) {
        const row = this.db.prepare('SELECT seen_at FROM briefing_seen WHERE reader = ? AND source = ?').get(reader, source);
        return row ? Number(row.seen_at) : undefined;
    }
    markSeen(reader, source, at) {
        this.db.prepare(`INSERT INTO briefing_seen VALUES (?, ?, ?) ON CONFLICT(reader, source) DO UPDATE SET seen_at = excluded.seen_at`).run(reader, source, at);
    }
    route(messageId) {
        const row = this.db.prepare('SELECT * FROM routing_events WHERE message_id = ?').get(messageId);
        return row ? {
            messageId: String(row.message_id), gatewayId: String(row.gateway_id),
            decision: JSON.parse(String(row.decision)),
            status: String(row.status),
        } : undefined;
    }
    /** The main chat used last (by its latest routed message), else the newest one; shared by every browser. */
    latestGateway(gatewayKey) {
        const row = this.db.prepare(`SELECT gs.gateway_id FROM gateway_sessions gs
      LEFT JOIN routing_events r ON r.gateway_id = gs.gateway_id
      WHERE gs.gateway_key = ? GROUP BY gs.gateway_id
      ORDER BY MAX(r.rowid) IS NULL, MAX(r.rowid) DESC, MAX(gs.rowid) DESC LIMIT 1`).get(gatewayKey);
        return row ? String(row.gateway_id) : undefined;
    }
    recentGatewayIds(gatewayKey, excludingId) {
        return this.db.prepare(`SELECT gs.gateway_id FROM gateway_sessions gs
      JOIN routing_events r ON r.gateway_id = gs.gateway_id
      WHERE gs.gateway_key = ? AND gs.gateway_id != ? AND r.status = 'completed'
      GROUP BY gs.gateway_id ORDER BY MAX(r.rowid) DESC LIMIT 2`)
            .all(gatewayKey, excludingId).map(row => String(row.gateway_id));
    }
    /**
     * Idempotent planning reserves a worker ID before any DSH creation. A message planned while another
     * reply runs (`mount` false) leaves the topic in use as it is until main chat gets to it.
     */
    plan(messageId, gatewayId, gatewayKey, proposed, mount = true) {
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
            if (decision.contextId && mount) {
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
    /** Drop the route of a message main chat never got to (the user deleted it from the queue). */
    forget(messageId) {
        this.db.prepare("DELETE FROM routing_events WHERE message_id = ? AND status IN ('planned', 'running')").run(messageId);
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
    /** What a route was decided from: a short redacted excerpt and the classifier's receipt. */
    recordRouteDetail(messageId, excerpt, receipt) {
        this.db.prepare('INSERT OR IGNORE INTO route_details(message_id, excerpt, receipt) VALUES (?, ?, ?)').run(messageId, excerpt, JSON.stringify(receipt));
    }
    /** This entry's latest routes, newest first. */
    recentRoutes(gatewayKey, limit = 20) {
        return this.db.prepare(`SELECT r.message_id, r.decision, r.status, r.created_at, d.excerpt, d.receipt, d.corrected_to
      FROM routing_events r JOIN gateway_sessions gs ON gs.gateway_id = r.gateway_id
      LEFT JOIN route_details d ON d.message_id = r.message_id
      WHERE gs.gateway_key = ? ORDER BY r.rowid DESC LIMIT ?`).all(gatewayKey, limit).map(row => ({
            messageId: String(row.message_id), decision: JSON.parse(String(row.decision)), status: String(row.status),
            at: Date.parse(String(row.created_at).replace(' ', 'T') + 'Z'), excerpt: row.excerpt == null ? '' : String(row.excerpt),
            ...(row.receipt ? { receipt: JSON.parse(String(row.receipt)) } : {}), ...(row.corrected_to ? { correctedTo: String(row.corrected_to) } : {}),
        }));
    }
    /** Record that a message belonged to another topic; later routing learns from it. */
    correctRoute(messageId, contextId, now = Date.now()) {
        if (!this.route(messageId))
            throw new Error('Unknown route');
        if (!this.contexts().some(context => context.id === contextId))
            throw new Error('Unknown Context');
        this.db.prepare(`INSERT INTO route_details(message_id, excerpt, corrected_to, corrected_at) VALUES (?, '', ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET corrected_to = excluded.corrected_to, corrected_at = excluded.corrected_at`).run(messageId, contextId, now);
    }
    /**
     * Terms a correction showed belong to a topic (positive delta) or not (negative). Weights fade
     * over time, stay within 0–5, and a term that falls to nothing is forgotten.
     */
    learnTerms(contextId, terms, delta, now = Date.now()) {
        if (!this.contexts().some(context => context.id === contextId))
            return;
        for (const raw of new Set(terms.map(term => term.trim()).filter(term => term.length >= 2 && term.length <= 24))) {
            const row = this.db.prepare('SELECT weight, updated_at FROM learned_terms WHERE context_id = ? AND term = ?').get(contextId, raw);
            const current = row ? row.weight * 0.5 ** ((now - row.updated_at) / TERM_HALF_LIFE_MS) : 0;
            const weight = Math.min(5, current + delta);
            if (weight <= 0.05)
                this.db.prepare('DELETE FROM learned_terms WHERE context_id = ? AND term = ?').run(contextId, raw);
            else
                this.db.prepare('INSERT OR REPLACE INTO learned_terms VALUES (?, ?, ?, ?)').run(contextId, raw, weight, now);
        }
    }
    /** Each topic's learned terms that still count (weight > 0.5 after fading), strongest first. */
    learnedTerms(now = Date.now(), limit = 20) {
        const result = new Map();
        for (const row of this.db.prepare('SELECT * FROM learned_terms').all()) {
            const weight = row.weight * 0.5 ** ((now - row.updated_at) / TERM_HALF_LIFE_MS);
            if (weight <= 0.5)
                continue;
            result.set(row.context_id, [...result.get(row.context_id) ?? [], { term: row.term, weight }]);
        }
        return new Map([...result].map(([id, terms]) => [id, terms.sort((a, b) => b.weight - a.weight).slice(0, limit).map(item => item.term)]));
    }
    /** How routing has gone lately: of the last `limit` messages, how many were moved, asked about or routed by rules after a failure. */
    routeStats(gatewayKey, limit = 100) {
        const routes = this.recentRoutes(gatewayKey, limit);
        return { total: routes.length,
            corrected: routes.filter(route => route.correctedTo && route.correctedTo !== route.decision.contextId).length,
            clarified: routes.filter(route => route.decision.action === 'CLARIFY').length,
            fallback: routes.filter(route => route.decision.reason.startsWith('router-fallback:')).length };
    }
    /** Corrections as examples for the classifier: this text belonged there, not here. Newest first. */
    corrections(gatewayKey, limit = 50) {
        const known = new Set(this.contexts().map(context => context.id));
        return this.db.prepare(`SELECT d.excerpt, d.corrected_to, r.decision FROM route_details d
      JOIN routing_events r ON r.message_id = d.message_id JOIN gateway_sessions gs ON gs.gateway_id = r.gateway_id
      WHERE gs.gateway_key = ? AND d.corrected_to IS NOT NULL AND d.excerpt != '' ORDER BY d.corrected_at DESC LIMIT ?`).all(gatewayKey, limit * 2)
            .flatMap(row => {
            const wrongId = JSON.parse(String(row.decision)).contextId;
            const rightId = String(row.corrected_to);
            // A message moved back where it first went teaches nothing.
            return known.has(rightId) && wrongId !== rightId ? [{ text: String(row.excerpt), ...(wrongId && known.has(wrongId) ? { wrongId } : {}), rightId }] : [];
        }).slice(0, limit);
    }
    writeDescriptor(context) {
        const { workingSessionId: _, ...descriptor } = context;
        this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?').run(JSON.stringify(descriptor), context.id);
    }
    context(contextId) {
        const context = this.contexts().find(item => item.id === contextId);
        if (!context)
            throw new Error('Unknown Context');
        return context;
    }
    /** Terms a correction showed belong to this topic, newest kept first. */
    addKeywords(contextId, terms) {
        const context = this.context(contextId);
        const seen = new Set();
        const keywords = [...terms, ...context.keywords].filter(term => {
            const key = term.toLowerCase();
            if (!term.trim() || seen.has(key))
                return false;
            seen.add(key);
            return true;
        }).slice(0, 40);
        this.writeDescriptor({ ...context, keywords });
    }
    /** The user's own wording for a topic outranks what the catalog extracted. */
    editTopic(contextId, change) {
        const context = this.context(contextId);
        const title = change.title?.trim();
        if (title !== undefined && (!title || title.length > 80 || this.contexts().some(other => other.id !== contextId && other.title.toLowerCase() === title.toLowerCase())))
            throw new Error('Invalid topic title');
        const summary = change.summary?.trim();
        if (summary !== undefined && (!summary || summary.length > 2000))
            throw new Error('Invalid topic summary');
        this.writeDescriptor({ ...context, ...(title ? { title } : {}), ...(summary ? { summary } : {}) });
        // A hand-written summary is kept like a compaction summary: re-indexing will not overwrite it.
        if (summary)
            this.db.prepare("INSERT OR REPLACE INTO context_summary_updates(context_id, session_id, summary_seq, end_seq, summary) VALUES (?, 'user', 0, 0, ?)").run(contextId, summary);
    }
    createTopic(title, summary) {
        const name = title.trim();
        if (!name || name.length > 80 || this.contexts().some(context => context.title.toLowerCase() === name.toLowerCase()))
            throw new Error('Invalid topic title');
        const id = randomUUID();
        this.seed([{ id, title: name, summary: summary?.trim() || '新话题，尚无历史摘要。', entities: [], keywords: [name], lastState: '等待首次执行' }]);
        return id;
    }
    /**
     * A branch of a topic: a new topic with the same descriptor, constraints, privacy, workspace and
     * folder, whose work continues in `workingSessionId` (a fork of the topic's session).
     */
    branchTopic(sourceId, title, workingSessionId, cwd) {
        const source = this.context(sourceId);
        const id = randomUUID();
        this.db.prepare('INSERT INTO contexts VALUES (?, ?, ?)').run(id, JSON.stringify({ ...source, id, title, workingSessionId: undefined }), workingSessionId);
        this.db.prepare('INSERT INTO context_origins VALUES (?, ?, ?)').run(id, workingSessionId, cwd ?? this.origin(sourceId)?.cwd ?? null);
        const group = this.db.prepare('SELECT group_id FROM topic_group_members WHERE context_id = ?').get(sourceId);
        if (group)
            this.db.prepare('INSERT OR REPLACE INTO topic_group_members VALUES (?, ?)').run(id, String(group.group_id));
        const constraints = this.constraints(sourceId);
        if (constraints)
            this.setConstraints(id, constraints.text);
        if (this.isPrivate(sourceId))
            this.setPrivate(id, true);
        return id;
    }
    /** Put a topic in another topic workspace, or a new one named `title`; null leaves it unassigned. */
    moveTopic(contextId, target) {
        this.context(contextId);
        if (target === null) {
            this.db.prepare('DELETE FROM topic_group_members WHERE context_id = ?').run(contextId);
            return;
        }
        let groupId;
        if ('groupId' in target) {
            if (!this.db.prepare('SELECT 1 FROM topic_groups WHERE id = ?').get(target.groupId))
                throw new Error('Unknown topic workspace');
            groupId = target.groupId;
        }
        else {
            const title = target.title.trim();
            if (!title || title.length > 80)
                throw new Error('Invalid topic workspace title');
            const normalized = title.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
            groupId = 'group-' + createHash('sha256').update(normalized).digest('hex').slice(0, 20);
            this.db.prepare('INSERT OR IGNORE INTO topic_groups VALUES (?, ?, ?, ?)').run(groupId, title, '', normalized);
        }
        this.db.prepare('INSERT OR REPLACE INTO topic_group_members VALUES (?, ?)').run(contextId, groupId);
    }
    /** Attach a whole existing session to a topic as reviewed history its Worker may search. */
    attachSession(contextId, sessionId) {
        this.addSource(contextId, sessionId, WHOLE_SESSION);
    }
    /**
     * Fold `sourceId` into `targetId`: its history, progress, summaries and links move over, and its
     * own Worker session becomes searchable history of the target. The source topic is removed.
     */
    mergeTopics(sourceId, targetId) {
        if (sourceId === targetId)
            throw new Error('Cannot merge a topic into itself');
        const source = this.context(sourceId), target = this.context(targetId);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const merged = (a, b) => [...new Map([...a, ...b].map(term => [term.toLowerCase(), term])).values()].slice(0, 40);
            this.writeDescriptor({ ...target, entities: merged(target.entities, source.entities), keywords: merged(target.keywords, source.keywords) });
            this.db.prepare('INSERT OR IGNORE INTO context_source_ranges SELECT ?, session_id, start_seq, end_seq FROM context_source_ranges WHERE context_id = ?').run(targetId, sourceId);
            // The source's own Worker conversation is now reviewed history of the target, not a new catalog source.
            this.markIndex(source.workingSessionId, Number.MAX_SAFE_INTEGER, 'excluded');
            this.db.prepare('INSERT OR IGNORE INTO context_source_ranges VALUES (?, ?, ?, ?)').run(targetId, source.workingSessionId, WHOLE_SESSION.startSeq, WHOLE_SESSION.endSeq);
            for (const table of ['history_turns', 'context_state_updates'])
                this.db.prepare(`UPDATE ${table} SET context_id = ? WHERE context_id = ?`).run(targetId, sourceId);
            this.db.prepare('UPDATE OR IGNORE context_summary_updates SET context_id = ? WHERE context_id = ?').run(targetId, sourceId);
            this.db.prepare('UPDATE gateway_state SET context_id = ? WHERE context_id = ?').run(targetId, sourceId);
            this.db.prepare('UPDATE route_details SET corrected_to = ? WHERE corrected_to = ?').run(targetId, sourceId);
            this.db.prepare('INSERT OR IGNORE INTO learned_terms SELECT ?, term, weight, updated_at FROM learned_terms WHERE context_id = ?').run(targetId, sourceId);
            const rules = [this.constraints(targetId)?.text, this.constraints(sourceId)?.text].filter(Boolean);
            if (rules.length)
                this.setConstraints(targetId, rules.join('\n').slice(0, 400));
            for (const link of this.links(sourceId)) {
                const other = link.a === sourceId ? link.b : link.a;
                if (other === targetId)
                    continue;
                if (link.manual)
                    this.setManualLink(targetId, other, link.manual);
                if (link.weight > 0)
                    this.learnLink(targetId, other, link.weight);
            }
            this.mergeFacts(sourceId, targetId, source.title);
            this.purge(sourceId);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    /** Remove a topic and everything TheOne kept about it. DSH keeps the conversations themselves. */
    deleteTopic(contextId) {
        const context = this.context(contextId);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            // The catalog would otherwise find the same conversation again and bring the topic back.
            this.db.prepare('INSERT OR REPLACE INTO dismissed_turns SELECT session_id, user_seq, fingerprint FROM history_turns WHERE context_id = ?').run(contextId);
            this.markIndex(context.workingSessionId, Number.MAX_SAFE_INTEGER, 'excluded');
            this.purge(contextId);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    purge(contextId) {
        for (const table of ['topic_group_members', 'history_turns', 'context_origins', 'context_sources', 'context_source_ranges',
            'gateway_state', 'context_state_updates', 'context_summary_updates', 'topic_flags', 'compaction_digests', 'learned_terms'])
            this.db.prepare(`DELETE FROM ${table} WHERE context_id = ?`).run(contextId);
        this.db.prepare('DELETE FROM topic_links WHERE a = ? OR b = ?').run(contextId, contextId);
        this.db.prepare('DELETE FROM hidden_contexts WHERE context_id = ?').run(contextId);
        this.db.prepare('DELETE FROM briefing_seen WHERE reader = ? OR source = ?').run(contextId, contextId);
        this.db.prepare('UPDATE route_details SET corrected_to = NULL, corrected_at = NULL WHERE corrected_to = ?').run(contextId);
        this.purgeFacts(contextId);
        this.db.prepare('DELETE FROM contexts WHERE id = ?').run(contextId);
    }
    // ---- Facts: a topic's settled items, versioned, with evidence. Runs inside the caller's transaction where one is open.
    factQuery(where) {
        return `SELECT f.*, v.status, v.value, v.evidence, v.origin, v.created_at FROM facts f
      LEFT JOIN fact_versions v ON v.fact_id = f.id AND v.version = f.current_version WHERE ${where}`;
    }
    factFrom(row) {
        return { id: String(row.id), contextId: String(row.context_id), key: String(row.key), label: String(row.label),
            aliases: JSON.parse(String(row.aliases)), kind: String(row.kind), version: Number(row.current_version),
            status: (row.status ? String(row.status) : 'retracted'), value: row.value == null ? null : String(row.value),
            evidence: row.evidence ? JSON.parse(String(row.evidence)) : { sessionId: '', seq: null, speaker: 'unverified', quote: '' },
            origin: (row.origin ? String(row.origin) : 'worker'), createdAt: Number(row.created_at ?? 0),
            ...(row.deleted_at != null ? { deletedAt: Number(row.deleted_at) } : {}), ...(row.merged_from ? { mergedFrom: String(row.merged_from) } : {}) };
    }
    /** A fact's current state, also when its topic was deleted (then it has no value). */
    fact(factId) {
        const row = this.db.prepare(this.factQuery('f.id = ?')).get(factId);
        return row && { ...this.factFrom(row), ...(row.last_used_at != null ? { lastUsedAt: Number(row.last_used_at) } : {}) };
    }
    /** One earlier version of a fact. */
    factVersion(factId, version) {
        const row = this.db.prepare(`SELECT f.*, v.status, v.value, v.evidence, v.origin, v.created_at, v.version AS current_version FROM facts f
      JOIN fact_versions v ON v.fact_id = f.id WHERE f.id = ? AND v.version = ?`).get(factId, version);
        return row && this.factFrom(row);
    }
    /** A topic's live facts; include withdrawn identities when taking a write/extraction baseline. */
    facts(contextId, includeRetracted = false) {
        return this.db.prepare(this.factQuery(`f.context_id = ? AND f.deleted_at IS NULL ${includeRetracted ? '' : "AND v.status != 'retracted'"} ORDER BY COALESCE(f.last_used_at, v.created_at) DESC`)).all(contextId)
            .map(row => this.factFrom(row));
    }
    /** Confirmed facts of every other live topic, the pool other topics may draw from. */
    sharedFacts(excludeContextId) {
        return this.db.prepare(this.factQuery("f.deleted_at IS NULL AND v.status = 'confirmed' AND f.context_id != ?")).all(excludeContextId ?? '')
            .map(row => ({ ...this.factFrom(row), ...(row.last_used_at != null ? { lastUsedAt: Number(row.last_used_at) } : {}) }));
    }
    factByName(contextId, key) {
        const exact = this.db.prepare(this.factQuery('f.context_id = ? AND f.key = ? AND f.deleted_at IS NULL')).get(contextId, key);
        if (exact)
            return this.factFrom(exact);
        return this.facts(contextId).find(fact => fact.aliases.includes(key))
            ?? this.db.prepare(this.factQuery("f.context_id = ? AND f.deleted_at IS NULL AND v.status = 'retracted'")).all(contextId)
                .map(row => this.factFrom(row)).find(fact => fact.aliases.includes(key));
    }
    /** Refuse a write that is older than what the fact already holds. */
    staleWrite(current, evidence, expectedVersion) {
        if (expectedVersion !== undefined && expectedVersion !== current.version)
            return 'stale';
        // Within one session, evidence only moves forward: a slow write from an earlier turn cannot win.
        if (current.evidence.sessionId === evidence.sessionId && current.evidence.seq != null && evidence.seq != null && evidence.seq < current.evidence.seq)
            return 'older-evidence';
        return undefined;
    }
    newerEvidence(current, evidence) {
        return evidence.sessionId !== current.evidence.sessionId ||
            (evidence.seq != null && (current.evidence.seq == null || evidence.seq > current.evidence.seq));
    }
    inTransaction(work) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = work();
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    addVersion(factId, version, status, value, evidence, origin, now) {
        this.db.prepare('INSERT INTO fact_versions VALUES (?, ?, ?, ?, ?, ?, ?)').run(factId, version, status, value, JSON.stringify(evidence), origin, now);
        this.db.prepare('UPDATE facts SET current_version = ? WHERE id = ?').run(version, factId);
    }
    /**
     * Record a fact or a new value of it. Same fact means the given id, or the same folded name or alias
     * within the topic; names are never matched loosely. The write is refused when it is stale, when its
     * evidence is older than the current version's, or when a proposal would replace a confirmed value.
     */
    recordFact(contextId, write, now = Date.now()) {
        this.context(contextId);
        const label = safe(write.label, FACT_LIMITS.label), key = factKey(label), value = safe(write.value, FACT_LIMITS.value);
        if (!key || !value || !FACT_KINDS.includes(write.kind))
            return { outcome: 'rejected', reason: 'invalid' };
        const evidence = { ...write.evidence, quote: safe(write.evidence.quote, FACT_LIMITS.quote) };
        const aliasKeys = (names, exclude = key) => [...new Set(names.map(name => factKey(safe(name, FACT_LIMITS.alias))).filter(alias => alias && alias !== exclude))].slice(0, FACT_LIMITS.aliases);
        return this.inTransaction(() => {
            const current = write.factId ? this.fact(write.factId) : this.factByName(contextId, key);
            if (write.factId && (!current || current.contextId !== contextId || current.deletedAt !== undefined))
                return { outcome: 'rejected', reason: 'unknown-fact' };
            if (!current) {
                if (this.db.prepare('SELECT 1 FROM facts WHERE context_id = ? AND key = ?').get(contextId, key))
                    return { outcome: 'rejected', reason: 'invalid' };
                const id = 'fact_' + randomUUID().replaceAll('-', '').slice(0, 20);
                this.db.prepare('INSERT INTO facts (id, context_id, key, label, aliases, kind, current_version) VALUES (?, ?, ?, ?, ?, ?, 0)')
                    .run(id, contextId, key, label, JSON.stringify(aliasKeys(write.aliases ?? [])), write.kind);
                this.addVersion(id, 1, write.status, value, evidence, write.origin, now);
                return { outcome: 'created', fact: this.fact(id) };
            }
            const refused = this.staleWrite(current, evidence, write.expectedVersion)
                ?? (current.status === 'confirmed' && write.status === 'proposed' ? 'keeps-confirmed' : undefined);
            if (refused)
                return { outcome: 'rejected', reason: refused, fact: current };
            const aliases = [...new Set([...current.aliases, ...aliasKeys([...(write.aliases ?? []), ...(key !== current.key ? [label] : [])], current.key)])]
                .filter(alias => alias !== current.key).slice(0, FACT_LIMITS.aliases);
            this.db.prepare('UPDATE facts SET aliases = ? WHERE id = ?').run(JSON.stringify(aliases), current.id);
            // A later reaffirmation is a new version too: delayed writes must not undo the user's latest words.
            if (current.status === write.status && current.value === value && !this.newerEvidence(current, evidence))
                return { outcome: 'unchanged', fact: this.fact(current.id) };
            this.addVersion(current.id, current.version + 1, write.status, value, evidence, write.origin, now);
            return { outcome: 'updated', fact: this.fact(current.id), previous: current };
        });
    }
    /** The user said a fact no longer holds (or is not decided yet): a new version without a value. */
    retractFact(contextId, factId, evidence, origin, expectedVersion, now = Date.now()) {
        return this.inTransaction(() => {
            const current = this.fact(factId);
            if (!current || current.contextId !== contextId || current.deletedAt !== undefined)
                return { outcome: 'rejected', reason: 'unknown-fact' };
            const quoted = { ...evidence, quote: safe(evidence.quote, FACT_LIMITS.quote) };
            const refused = this.staleWrite(current, quoted, expectedVersion);
            if (refused)
                return { outcome: 'rejected', reason: refused, fact: current };
            if (current.status === 'retracted' && !this.newerEvidence(current, quoted))
                return { outcome: 'unchanged', fact: current };
            this.addVersion(current.id, current.version + 1, 'retracted', null, quoted, origin, now);
            return { outcome: 'retracted', fact: this.fact(current.id), previous: current };
        });
    }
    /** A fact reached a topic (by routing, a lookup or a change notice): log it and note the version seen. */
    recordDelivery(contextId, fact, via, inputId, now = Date.now()) {
        this.db.prepare('INSERT INTO fact_deliveries (context_id, fact_id, version, input_id, via, at) VALUES (?, ?, ?, ?, ?, ?)').run(contextId, fact.id, fact.version, inputId ?? null, via, now);
        this.db.prepare(`INSERT INTO fact_dependencies VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(context_id, fact_id) DO UPDATE SET version_seen = excluded.version_seen, last_at = excluded.last_at`).run(contextId, fact.id, fact.version, now, now);
        if (via !== 'notice')
            this.db.prepare('UPDATE facts SET last_used_at = ? WHERE id = ?').run(now, fact.id);
    }
    /** The facts a topic has been given, with the version it last saw. */
    dependencies(contextId) {
        return this.db.prepare('SELECT fact_id, version_seen FROM fact_dependencies WHERE context_id = ? ORDER BY first_at').all(contextId)
            .map(row => ({ factId: String(row.fact_id), versionSeen: Number(row.version_seen) }));
    }
    forgetDependency(contextId, factId) {
        this.db.prepare('DELETE FROM fact_dependencies WHERE context_id = ? AND fact_id = ?').run(contextId, factId);
    }
    /** Delivery log of a topic, oldest first. */
    deliveries(contextId) {
        return this.db.prepare('SELECT * FROM fact_deliveries WHERE context_id = ? ORDER BY id').all(contextId)
            .map(row => ({ factId: String(row.fact_id), version: Number(row.version), via: String(row.via), ...(row.input_id ? { inputId: String(row.input_id) } : {}) }));
    }
    /**
     * Facts of a merged topic move with their identity, so whoever depends on them keeps doing so. A name
     * both topics use stays two facts: the incoming one is renamed after its topic; values never merge.
     */
    mergeFacts(sourceId, targetId, sourceTitle) {
        for (const fact of this.db.prepare('SELECT id, key, label FROM facts WHERE context_id = ? AND deleted_at IS NULL').all(sourceId)) {
            let key = String(fact.key), label = String(fact.label);
            if (this.db.prepare('SELECT 1 FROM facts WHERE context_id = ? AND key = ?').get(targetId, key)) {
                label = `${label}（来自 ${sourceTitle}）`.slice(0, FACT_LIMITS.label + 30);
                key = factKey(label);
                for (let n = 2; this.db.prepare('SELECT 1 FROM facts WHERE context_id = ? AND key = ?').get(targetId, key); n++)
                    key = `${factKey(label)} ${n}`;
            }
            this.db.prepare('UPDATE facts SET context_id = ?, key = ?, label = ?, merged_from = ? WHERE id = ?').run(targetId, key, label, sourceId, String(fact.id));
        }
        this.db.prepare('INSERT OR IGNORE INTO fact_dependencies SELECT ?, fact_id, version_seen, first_at, last_at FROM fact_dependencies WHERE context_id = ?').run(targetId, sourceId);
        this.db.prepare('DELETE FROM fact_dependencies WHERE context_id = ?').run(sourceId);
        // A topic does not depend on its own facts.
        this.db.prepare('DELETE FROM fact_dependencies WHERE context_id = ? AND fact_id IN (SELECT id FROM facts WHERE context_id = ?)').run(targetId, targetId);
        this.db.prepare('UPDATE fact_deliveries SET context_id = ? WHERE context_id = ?').run(targetId, sourceId);
    }
    /**
     * A deleted topic's facts lose their values and evidence; the identity stays as a tombstone so that
     * topics which used them can be told once that they are gone. What the topic itself received goes.
     */
    purgeFacts(contextId, now = Date.now()) {
        this.db.prepare('DELETE FROM fact_versions WHERE fact_id IN (SELECT id FROM facts WHERE context_id = ?)').run(contextId);
        this.db.prepare("UPDATE facts SET deleted_at = ?, aliases = '[]', current_version = 0 WHERE context_id = ? AND deleted_at IS NULL").run(now, contextId);
        this.db.prepare('DELETE FROM fact_dependencies WHERE context_id = ?').run(contextId);
        this.db.prepare('DELETE FROM fact_deliveries WHERE context_id = ?').run(contextId);
    }
    /** Notices the user closed; they are not shown again on any browser. */
    dismissNotice(id, now = Date.now()) {
        this.db.prepare('INSERT OR IGNORE INTO dismissed_notices VALUES (?, ?)').run(id, now);
    }
    /** True the first time `name` is marked, false ever after: for one-time repairs. */
    markOnce(name, now = Date.now()) {
        return this.db.prepare('INSERT OR IGNORE INTO plugin_flags VALUES (?, ?)').run(name, now).changes === 1;
    }
    dismissedNotices() {
        return new Set(this.db.prepare('SELECT id FROM dismissed_notices').all().map(row => String(row.id)));
    }
    /**
     * Topics kept in the directory but hidden from routing and briefings: every conversation they can
     * draw on is gone from disk (`orphaned`) or archived in DSH (`archived`). The catalog scan
     * recomputes this set, so restoring a conversation or unarchiving it brings the topic back.
     */
    hiddenReasons() {
        return new Map(this.db.prepare('SELECT context_id, reason FROM hidden_contexts').all()
            .map(row => [String(row.context_id), String(row.reason)]));
    }
    /** Replace the hidden set in one write, so a scan never leaves a stale entry behind. */
    replaceHidden(entries, now = Date.now()) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare('DELETE FROM hidden_contexts').run();
            const insert = this.db.prepare('INSERT OR REPLACE INTO hidden_contexts VALUES (?, ?, ?)');
            for (const entry of entries)
                insert.run(entry.id, entry.reason, now);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    close() { this.db.close(); }
}
