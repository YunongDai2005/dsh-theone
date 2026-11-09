export const CATALOG_ORPHAN_REPAIR = 'catalog-orphan-repair-v1';
/** Read-only, shared by import cleanup, the one-time repair and its dry run. Absence of a
 * source alone is insufficient: any evidence of a Worker, routing or user work protects it. */
export function catalogOrphans(db) {
    const untouched = ['context_sources', 'context_source_ranges', 'history_turns', 'topic_runs',
        'learning_routes', 'learning_turns', 'context_state_updates', 'context_summary_updates',
        'topic_flags', 'compaction_digests', 'topic_names', 'topic_settled', 'topic_open', 'topic_status',
        'learned_terms', 'correction_terms', 'facts', 'fact_dependencies', 'fact_deliveries', 'gateway_state']
        .map(table => `NOT EXISTS (SELECT 1 FROM ${table} WHERE context_id = c.id)`).join('\n AND ');
    return db.prepare(`SELECT c.id, c.descriptor, o.session_id FROM contexts c
    JOIN context_origins o ON o.context_id = c.id
    WHERE o.session_id != c.working_session_id AND ${untouched}
      AND NOT EXISTS (SELECT 1 FROM history_index WHERE session_id = c.working_session_id)
      AND NOT EXISTS (SELECT 1 FROM catalog_seen_sessions WHERE session_id = c.working_session_id)
      AND NOT EXISTS (SELECT 1 FROM learning_turns WHERE session_id = c.working_session_id)
      AND NOT EXISTS (SELECT 1 FROM topic_runs WHERE session_id = c.working_session_id)
      AND NOT EXISTS (SELECT 1 FROM routing_events WHERE json_extract(decision, '$.contextId') = c.id)
      AND NOT EXISTS (SELECT 1 FROM route_details WHERE corrected_to = c.id)
      AND NOT EXISTS (SELECT 1 FROM misrouted_turns WHERE context_id = c.id OR moved_to = c.id)
      AND NOT EXISTS (SELECT 1 FROM topic_merges WHERE source_id = c.id OR target_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM topic_links WHERE a = c.id OR b = c.id)
      AND NOT EXISTS (SELECT 1 FROM briefing_seen WHERE reader = c.id)
      AND NOT EXISTS (SELECT 1 FROM plugin_flags WHERE name IN ('merge-moved:' || c.id, 'merge-handled:' || c.id))
      AND NOT EXISTS (SELECT 1 FROM learning_events
        WHERE (stream IN ('topic:' || c.id, 'group:' || c.id) AND kind NOT IN ('catalogDescriptor', 'assignGroup'))
          OR (kind IN ('mergeLearning', 'mergeLink') AND json_extract(args, '$[1]') = c.id))
    ORDER BY c.rowid`).all().map(row => ({ sourceId: String(row.id),
        title: String(JSON.parse(String(row.descriptor)).title), sessionId: String(row.session_id) }));
}
/** Old rows no longer say which turn they lost. Repair only a finished, single-owner session;
 * a mixed session or an absent owner is ambiguous and must be left alone. */
export function catalogOrphanRepairs(db) {
    const owners = db.prepare(`SELECT context_id FROM history_turns WHERE session_id = ?
    UNION SELECT context_id FROM context_source_ranges WHERE session_id = ?
    UNION SELECT context_id FROM context_sources WHERE session_id = ?`);
    const target = db.prepare(`SELECT c.id, c.descriptor FROM contexts c JOIN context_origins o ON o.context_id = c.id
    WHERE c.id = ? AND o.session_id = ?
      AND EXISTS (SELECT 1 FROM history_index WHERE session_id = o.session_id AND status = 'ready')
      AND EXISTS (SELECT 1 FROM history_turns WHERE session_id = o.session_id AND context_id = c.id)
      AND EXISTS (SELECT 1 FROM context_source_ranges WHERE session_id = o.session_id AND context_id = c.id)`);
    return catalogOrphans(db).flatMap(orphan => {
        const ids = owners.all(orphan.sessionId, orphan.sessionId, orphan.sessionId);
        if (ids.length !== 1)
            return [];
        const row = target.get(String(ids[0].context_id), orphan.sessionId);
        return row ? [{ ...orphan, targetId: String(row.id), targetTitle: String(JSON.parse(String(row.descriptor)).title) }] : [];
    });
}
