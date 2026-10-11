# Backlog

Ideas and decisions that are agreed in principle but not started. Newest first.

## Standalone router (unified interface, first step)

Pull routing out of the DSH plugin into its own package so other entry points (a Telegram or QQ
bridge, a folder-based project hub, a future standalone client) can ask "which topic does this
message belong to?" without DSH.

- Already independent of DSH (type imports only): `src/llm-router.ts` prompt, `routingPayload`,
  `validateRoutingDecision`; `src/routing-policy.ts`; `src/router.ts`; `src/topic-memory.ts`.
  `eval/run-router.mjs` already runs this code outside DSH.
- Tied to DSH, to be replaced: the model call (`DshRouter` → any OpenAI-compatible endpoint or a
  caller-supplied function), candidate recall (DSH full-text search → SQLite FTS5 / BM25).
- Out of scope for the router: the sessions behind topics. The caller opens and runs them.
- Shape: library `route({ message, topics, current, recent })` → `{ action, topicId, reason }`, plus
  `correct()` and `card()`; a stdin/stdout JSON CLI; optionally a local HTTP server. Topics, routes
  and learned corrections in its own SQLite file. The DSH plugin then uses the package too.
- Gate: the InterleaveBench numbers (closed 91.6, open 86.6) must reproduce after the split.
- This is a structural change: write the split plan (layout, interfaces, how the plugin changes)
  and agree it before starting.
