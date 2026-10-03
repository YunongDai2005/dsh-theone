import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { ExtractedTopic, HistoryPart, TopicGroup } from './catalog-types.ts'
import type { ContextDescriptor, ContextUsage, Decision, RouteRecord, StoredContext, SourceRange, TopicLink } from './types.ts'

/** Stores descriptors and routing metadata. Original conversation stays in DSH. */
export class ContextStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
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
    `)
  }

  settings(gatewayKey: string): { values: unknown; revision: number } | undefined {
    const row = this.db.prepare('SELECT settings, revision FROM plugin_settings WHERE gateway_key = ?').get(gatewayKey) as { settings: string; revision: number } | undefined
    if (!row) return
    let values: unknown
    try { values = JSON.parse(row.settings) } catch { /* A fresh save can repair malformed preferences. */ }
    return { values, revision: row.revision }
  }

  saveSettings(gatewayKey: string, values: unknown, revision: number): boolean {
    const result = this.db.prepare(`INSERT INTO plugin_settings(gateway_key, settings, revision)
      SELECT ?, ?, 1 WHERE ? = 0 OR EXISTS(SELECT 1 FROM plugin_settings WHERE gateway_key = ? AND revision = ?)
      ON CONFLICT(gateway_key) DO UPDATE SET settings = excluded.settings, revision = plugin_settings.revision + 1
      WHERE plugin_settings.revision = ?`).run(gatewayKey, JSON.stringify(values), revision, gatewayKey, revision, revision)
    return result.changes === 1
  }

  /** Only model identity is persisted. API credentials remain owned by DSH. */
  rememberModel(gatewayKey: string, selection: ModelSelection): void {
    if (!selection.provider || !selection.model || selection.provider === 'theone') throw new Error('Invalid backing model')
    const value = { provider: selection.provider, model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}) }
    this.db.prepare('INSERT OR REPLACE INTO model_binding VALUES (?, ?)').run(gatewayKey, JSON.stringify(value))
  }

  rememberedModel(gatewayKey: string): ModelSelection | undefined {
    const row = this.db.prepare('SELECT selection FROM model_binding WHERE gateway_key = ?').get(gatewayKey)
    return row ? JSON.parse(String(row.selection)) as ModelSelection : undefined
  }

  seed(contexts: ContextDescriptor[]): void {
    for (const context of contexts) {
      this.db.prepare('INSERT OR IGNORE INTO contexts VALUES (?, ?, ?)')
        .run(context.id, JSON.stringify(context), randomUUID())
    }
  }

  contexts(): StoredContext[] {
    return this.db.prepare('SELECT * FROM contexts ORDER BY id').all().map(row => ({
      ...JSON.parse(String(row.descriptor)) as ContextDescriptor,
      workingSessionId: String(row.working_session_id),
    }))
  }

  /** Context ids, newest first. contexts() is ordered by id, and generated ids are random. */
  contextIdsByRecency(): string[] {
    return this.db.prepare('SELECT id FROM contexts ORDER BY rowid DESC').all().map(row => String(row.id))
  }

  current(gatewayKey: string): string | undefined {
    const row = this.db.prepare('SELECT context_id FROM gateway_state WHERE gateway_key = ?').get(gatewayKey)
    return row ? String(row.context_id) : undefined
  }

  /** Successful uses only: retries, failed work and clarification never heat a topic. */
  contextUsage(gatewayKey: string, now = Date.now()): ContextUsage[] {
    const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
    return this.db.prepare(`SELECT json_extract(r.decision, '$.contextId') AS context_id,
      COUNT(*) AS calls, SUM(r.created_at >= ?) AS recent_calls, MAX(r.created_at) AS last_used
      FROM routing_events r JOIN gateway_sessions gs ON gs.gateway_id = r.gateway_id
      WHERE gs.gateway_key = ? AND r.status = 'completed'
        AND json_extract(r.decision, '$.action') != 'CLARIFY'
        AND json_extract(r.decision, '$.contextId') IS NOT NULL
      GROUP BY context_id`).all(cutoff, gatewayKey).map(row => ({
        contextId: String(row.context_id), completedCalls: Number(row.calls),
        recentCalls: Number(row.recent_calls), lastUsedAt: Date.parse(String(row.last_used).replace(' ', 'T') + 'Z'),
      }))
  }

  groups(): TopicGroup[] {
    return this.db.prepare('SELECT * FROM topic_groups ORDER BY title').all().map(row => ({
      id: String(row.id), title: String(row.title), summary: String(row.summary),
      contextIds: this.db.prepare('SELECT context_id FROM topic_group_members WHERE group_id = ? ORDER BY context_id').all(String(row.id)).map(r => String(r.context_id)),
    })).filter(group => group.contextIds.length > 0)
  }

  isGateway(sessionId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM gateway_sessions WHERE gateway_id = ? LIMIT 1').get(sessionId)
  }

  /** Record the fixed "TheOne · Main chat" entry; other sessions may also use TheOne and switch away. */
  rememberGateway(gatewayKey: string, sessionId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO gateway_sessions VALUES (?, ?)').run(gatewayKey, sessionId)
    this.db.prepare('INSERT OR IGNORE INTO pinned_gateways VALUES (?)').run(sessionId)
  }

  isPinnedGateway(sessionId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM pinned_gateways WHERE gateway_id = ?').get(sessionId)
  }

  origin(contextId: string): { sessionId: string; cwd?: string } | undefined {
    const row = this.db.prepare('SELECT * FROM context_origins WHERE context_id = ?').get(contextId)
    return row ? { sessionId: String(row.session_id), ...(row.cwd ? { cwd: String(row.cwd) } : {}) } : undefined
  }

  indexState(sessionId: string): { throughSeq: number; status: string } | undefined {
    const row = this.db.prepare('SELECT * FROM history_index WHERE session_id = ?').get(sessionId)
    return row ? { throughSeq: Number(row.through_seq), status: String(row.status) } : undefined
  }

  markIndex(sessionId: string, throughSeq: number, status: 'ready' | 'failed' | 'skipped', errorCode?: string): void {
    this.db.prepare('INSERT OR REPLACE INTO history_index VALUES (?, ?, ?, ?)').run(sessionId, throughSeq, status, errorCode ?? null)
  }

  indexedTurn(sessionId: string, seq: number): { fingerprint: string; contextId: string } | undefined {
    const row = this.db.prepare('SELECT fingerprint, context_id FROM history_turns WHERE session_id = ? AND user_seq = ?').get(sessionId, seq)
    return row ? { fingerprint: String(row.fingerprint), contextId: String(row.context_id) } : undefined
  }

  /** One validated batch commits descriptors, groups and exact source ranges atomically. */
  importTopics(sessionId: string, cwd: string | undefined, parts: HistoryPart[], topics: ExtractedTopic[]): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const topic of topics) {
        const id = topic.contextId ?? randomUUID()
        const existing = this.contexts().find(context => context.id === id)
        // The Worker's own progress note and DSH compaction summary outrank a catalog re-extraction, which only
        // sees short excerpts; otherwise every re-index after a turn would overwrite them.
        const stated = existing && this.db.prepare('SELECT 1 FROM context_state_updates WHERE context_id = ? LIMIT 1').get(id)
        const summarized = existing && this.db.prepare('SELECT 1 FROM context_summary_updates WHERE context_id = ? LIMIT 1').get(id)
        const descriptor: ContextDescriptor = { id, title: existing?.title ?? topic.title,
          summary: summarized ? existing.summary : topic.summary, entities: topic.entities, keywords: topic.keywords,
          lastState: stated ? existing.lastState : topic.lastState }
        if (existing) this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?').run(JSON.stringify(descriptor), id)
        else {
          this.seed([descriptor])
          this.db.prepare('INSERT INTO context_origins VALUES (?, ?, ?)').run(id, sessionId, cwd ?? null)
        }
        let groupId = topic.groupId
        if (!groupId) {
          const title = topic.groupTitle || '待归类'
          const normalized = title.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
          groupId = 'group-' + createHash('sha256').update(normalized).digest('hex').slice(0, 20)
          this.db.prepare('INSERT OR IGNORE INTO topic_groups VALUES (?, ?, ?, ?)').run(groupId, title, topic.groupSummary, normalized)
        }
        this.db.prepare('INSERT OR REPLACE INTO topic_group_members VALUES (?, ?)').run(id, groupId)
        for (const seq of topic.turns) {
          const part = parts.find(part => part.seq === seq)!
          const old = this.db.prepare('SELECT * FROM history_turns WHERE session_id = ? AND user_seq = ?').get(sessionId, seq)
          if (old) this.db.prepare('DELETE FROM context_source_ranges WHERE context_id = ? AND session_id = ? AND start_seq = ? AND end_seq = ?')
            .run(String(old.context_id), sessionId, seq, Number(old.end_seq))
          this.addSource(id, sessionId, { startSeq: seq, endSeq: part.endSeq })
          this.db.prepare('INSERT OR REPLACE INTO history_turns VALUES (?, ?, ?, ?, ?)').run(sessionId, seq, part.endSeq, part.fingerprint, id)
        }
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  mount(gatewayKey: string, contextId: string): void {
    if (!this.contexts().some(context => context.id === contextId)) throw new Error('Unknown Context')
    this.db.prepare('INSERT INTO gateway_state VALUES (?, ?) ON CONFLICT(gateway_key) DO UPDATE SET context_id = excluded.context_id').run(gatewayKey, contextId)
  }

  contextsForSessions(sessionIds: string[]): string[] {
    const wanted = new Set(sessionIds)
    return this.contexts().filter(context => wanted.has(context.workingSessionId) || this.sources(context.id).some(id => wanted.has(id))).map(context => context.id)
  }

  /** Model-maintained progress is bounded and auditable; stable project identity remains unchanged. */
  updateState(contextId: string, state: string, sessionId: string, throughSeq: number): void {
    const context = this.contexts().find(item => item.id === contextId)
    if (!context || context.workingSessionId !== sessionId) throw new Error('State requires the owned Worker')
    if (!state.trim() || state.length > 800 || !Number.isSafeInteger(throughSeq) || throughSeq < 0) throw new Error('Invalid project state')
    if (/\bsk-[a-zA-Z0-9_-]{16,}|\bBearer\s+\S+|(?:api[_ -]?key|password|密码|密钥)\s*[:=：]\s*\S+/i.test(state)) throw new Error('Project state must not contain credentials')
    const { workingSessionId: _, ...descriptor } = context
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?').run(JSON.stringify({ ...descriptor, lastState: state.trim() }), contextId)
      this.db.prepare('INSERT INTO context_state_updates(context_id, session_id, through_seq, state) VALUES (?, ?, ?, ?)')
        .run(contextId, sessionId, throughSeq, state.trim())
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  stateUpdates(contextId: string) {
    return this.db.prepare('SELECT session_id AS sessionId, through_seq AS throughSeq, state, created_at AS createdAt FROM context_state_updates WHERE context_id = ? ORDER BY id').all(contextId)
  }

  /** Reuse a completed DSH compaction checkpoint once, without another model call. */
  updateSummary(contextId: string, summary: string, sessionId: string, summarySeq: number, endSeq: number): void {
    const context = this.contexts().find(item => item.id === contextId)
    if (!context || context.workingSessionId !== sessionId) throw new Error('Summary requires the owned Worker')
    if (!summary.trim() || summary.length > 1200 || !Number.isSafeInteger(summarySeq) || summarySeq < 0 || !Number.isSafeInteger(endSeq) || endSeq <= summarySeq) throw new Error('Invalid compaction reference')
    const { workingSessionId: _, ...descriptor } = context
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const inserted = this.db.prepare('INSERT OR IGNORE INTO context_summary_updates(context_id, session_id, summary_seq, end_seq, summary) VALUES (?, ?, ?, ?, ?)')
        .run(contextId, sessionId, summarySeq, endSeq, summary.trim())
      if (inserted.changes) this.db.prepare('UPDATE contexts SET descriptor = ? WHERE id = ?')
        .run(JSON.stringify({ ...descriptor, summary: summary.trim() }), contextId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  summaryUpdates(contextId: string) {
    return this.db.prepare('SELECT session_id AS sessionId, summary_seq AS summarySeq, end_seq AS endSeq, summary FROM context_summary_updates WHERE context_id = ? ORDER BY rowid').all(contextId)
  }

  /** Learned relatedness halves every two weeks without new evidence. */
  static readonly LINK_HALF_LIFE_MS = 14 * 86400000

  private pair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a] }

  /** Link rows touching one topic (or all), with learned weight decayed to `now`. */
  links(contextId?: string, now = Date.now()): TopicLink[] {
    const rows = contextId === undefined ? this.db.prepare('SELECT * FROM topic_links').all()
      : this.db.prepare('SELECT * FROM topic_links WHERE a = ? OR b = ?').all(contextId, contextId)
    return rows.map(row => ({ a: String(row.a), b: String(row.b), manual: Number(row.manual) as TopicLink['manual'],
      weight: Number(row.weight) * 0.5 ** (Math.max(0, now - Number(row.updated_at)) / ContextStore.LINK_HALF_LIFE_MS) }))
  }

  /** Add learned evidence; a pair the user unlinked never learns back. */
  learnLink(a: string, b: string, delta: number, now = Date.now()): void {
    if (a === b) return
    const [x, y] = this.pair(a, b)
    const existing = this.links(x, now).find(link => link.a === x && link.b === y)
    if (existing?.manual === -1) return
    const weight = Math.min(5, Math.max(0, (existing?.weight ?? 0) + delta))
    this.db.prepare(`INSERT INTO topic_links(a, b, weight, manual, updated_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(a, b) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`).run(x, y, weight, now)
  }

  /** 1 links a pair permanently, -1 keeps it apart, 0 returns it to learning. */
  setManualLink(a: string, b: string, manual: TopicLink['manual'], now = Date.now()): void {
    if (a === b) throw new Error('A topic cannot link to itself')
    const [x, y] = this.pair(a, b)
    this.db.prepare(`INSERT INTO topic_links(a, b, weight, manual, updated_at) VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(a, b) DO UPDATE SET manual = excluded.manual, weight = CASE WHEN excluded.manual = -1 THEN 0 ELSE topic_links.weight END`).run(x, y, manual, now)
  }

  /** Forget learned relatedness; the user's own links and separations stay. */
  clearLearnedLinks(): void {
    this.db.exec('DELETE FROM topic_links WHERE manual = 0; UPDATE topic_links SET weight = 0')
  }

  setPrivate(contextId: string, value: boolean): void {
    this.db.prepare(`INSERT INTO topic_flags(context_id, private) VALUES (?, ?)
      ON CONFLICT(context_id) DO UPDATE SET private = excluded.private`).run(contextId, value ? 1 : 0)
  }

  privateIds(): Set<string> {
    return new Set(this.db.prepare('SELECT context_id FROM topic_flags WHERE private = 1').all().map(row => String(row.context_id)))
  }

  /** Project directory of every topic that came from an existing session. */
  origins(): Map<string, string | undefined> {
    return new Map(this.db.prepare('SELECT context_id, cwd FROM context_origins').all().map(row => [String(row.context_id), row.cwd ? String(row.cwd) : undefined]))
  }

  isPrivate(contextId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM topic_flags WHERE context_id = ? AND private = 1').get(contextId)
  }

  /** Standing rules for a topic, kept apart from summaries so compaction cannot drop them. */
  setConstraints(contextId: string, text: string | null, now = Date.now()): void {
    const value = text?.trim() || null
    if (value && (value.length > 400 || /\bsk-[a-zA-Z0-9_-]{16,}|\bBearer\s+\S+/i.test(value))) throw new Error('Invalid topic constraints')
    this.db.prepare(`INSERT INTO topic_flags(context_id, constraints, constraints_at) VALUES (?, ?, ?)
      ON CONFLICT(context_id) DO UPDATE SET constraints = excluded.constraints, constraints_at = excluded.constraints_at`).run(contextId, value, now)
  }

  constraints(contextId: string): { text: string; at: number } | undefined {
    const row = this.db.prepare('SELECT constraints, constraints_at FROM topic_flags WHERE context_id = ? AND constraints IS NOT NULL').get(contextId)
    return row ? { text: String(row.constraints), at: Number(row.constraints_at) } : undefined
  }

  /** The latest full compaction summary of a topic's Worker and how far it covers. */
  saveDigest(contextId: string, summary: string, throughSeq: number, now = Date.now()): void {
    this.db.prepare(`INSERT INTO compaction_digests VALUES (?, ?, ?, ?) ON CONFLICT(context_id) DO UPDATE SET
      summary = excluded.summary, through_seq = excluded.through_seq, created_at = excluded.created_at
      WHERE excluded.through_seq > compaction_digests.through_seq`).run(contextId, summary.slice(0, 16000), throughSeq, now)
  }

  digest(contextId: string): { summary: string; throughSeq: number; at: number } | undefined {
    const row = this.db.prepare('SELECT * FROM compaction_digests WHERE context_id = ?').get(contextId)
    return row ? { summary: String(row.summary), throughSeq: Number(row.through_seq), at: Number(row.created_at) } : undefined
  }

  /** When `reader` last received `source`'s state in a briefing. */
  seen(reader: string, source: string): number | undefined {
    const row = this.db.prepare('SELECT seen_at FROM briefing_seen WHERE reader = ? AND source = ?').get(reader, source)
    return row ? Number(row.seen_at) : undefined
  }

  markSeen(reader: string, source: string, at: number): void {
    this.db.prepare(`INSERT INTO briefing_seen VALUES (?, ?, ?) ON CONFLICT(reader, source) DO UPDATE SET seen_at = excluded.seen_at`).run(reader, source, at)
  }

  route(messageId: string): RouteRecord | undefined {
    const row = this.db.prepare('SELECT * FROM routing_events WHERE message_id = ?').get(messageId)
    return row ? {
      messageId: String(row.message_id), gatewayId: String(row.gateway_id),
      decision: JSON.parse(String(row.decision)) as Decision,
      status: String(row.status) as RouteRecord['status'],
    } : undefined
  }

  recentGatewayIds(gatewayKey: string, excludingId: string): string[] {
    return this.db.prepare(`SELECT gs.gateway_id FROM gateway_sessions gs
      JOIN routing_events r ON r.gateway_id = gs.gateway_id
      WHERE gs.gateway_key = ? AND gs.gateway_id != ? AND r.status = 'completed'
      GROUP BY gs.gateway_id ORDER BY MAX(r.rowid) DESC LIMIT 2`)
      .all(gatewayKey, excludingId).map(row => String(row.gateway_id))
  }

  /** Idempotent planning reserves a worker ID before any DSH creation. */
  plan(messageId: string, gatewayId: string, gatewayKey: string, proposed: Decision): RouteRecord {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.route(messageId)
      if (existing) {
        this.db.exec('COMMIT')
        return existing
      }
      let decision = { ...proposed }
      if (decision.action === 'CREATE') {
        const context: ContextDescriptor = {
          id: randomUUID(), title: decision.title!, summary: '新话题，尚无历史摘要。',
          entities: [], keywords: [decision.title!], lastState: '等待首次执行',
        }
        this.seed([context])
        decision = { ...decision, contextId: context.id }
      }
      if (decision.contextId) {
        this.db.prepare('INSERT INTO gateway_state VALUES (?, ?) ON CONFLICT(gateway_key) DO UPDATE SET context_id = excluded.context_id')
          .run(gatewayKey, decision.contextId)
      }
      this.db.prepare('INSERT INTO routing_events(message_id, gateway_id, decision, status) VALUES (?, ?, ?, ?)')
        .run(messageId, gatewayId, JSON.stringify(decision), 'planned')
      this.db.prepare('INSERT OR IGNORE INTO gateway_sessions VALUES (?, ?)').run(gatewayKey, gatewayId)
      this.db.exec('COMMIT')
      return { messageId, gatewayId, decision, status: 'planned' }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Only a planned route may execute. Ambiguous interrupted work is never replayed automatically. */
  claim(messageId: string): void {
    const result = this.db.prepare("UPDATE routing_events SET status = 'running' WHERE message_id = ? AND status = 'planned'").run(messageId)
    if (result.changes !== 1) throw new Error('This input has already started. Inspect its DSH session before resubmitting; automatic replay is disabled.')
  }

  finish(messageId: string, status: 'completed' | 'failed'): void {
    this.db.prepare('UPDATE routing_events SET status = ? WHERE message_id = ?').run(status, messageId)
  }

  /** Whole-session access is allowed only for this Context's dedicated worker. */
  addSource(contextId: string, sessionId: string, range?: { startSeq: number; endSeq: number }): void {
    const context = this.contexts().find(item => item.id === contextId)
    if (!context) throw new Error('Unknown Context')
    if (range) {
      if (!Number.isSafeInteger(range.startSeq) || !Number.isSafeInteger(range.endSeq) ||
        range.startSeq < 0 || range.endSeq < range.startSeq) throw new Error('Invalid history event range')
      this.db.prepare('INSERT OR IGNORE INTO context_source_ranges VALUES (?, ?, ?, ?)')
        .run(contextId, sessionId, range.startSeq, range.endSeq)
    } else {
      if (sessionId !== context.workingSessionId) throw new Error('Historical sources require an explicit event range')
      this.db.prepare('INSERT OR IGNORE INTO context_sources VALUES (?, ?)').run(contextId, sessionId)
    }
  }

  /** Old unscoped historical mappings remain visible, but cannot be searched. */
  sourceRanges(contextId: string): SourceRange[] {
    const worker = this.contexts().find(item => item.id === contextId)?.workingSessionId
    const ranges: SourceRange[] = this.db.prepare('SELECT * FROM context_source_ranges WHERE context_id = ? ORDER BY session_id, start_seq')
      .all(contextId).map(row => ({ sessionId: String(row.session_id), kind: 'bounded', startSeq: Number(row.start_seq), endSeq: Number(row.end_seq) }))
    for (const row of this.db.prepare('SELECT session_id FROM context_sources WHERE context_id = ? ORDER BY session_id').all(contextId)) {
      const sessionId = String(row.session_id)
      if (ranges.some(range => range.sessionId === sessionId)) continue
      ranges.push({ sessionId, kind: sessionId === worker ? 'worker' : 'unscoped' })
    }
    return ranges
  }

  sources(contextId: string): string[] {
    return [...new Set(this.sourceRanges(contextId).map(source => source.sessionId))]
  }

  close(): void { this.db.close() }
}
