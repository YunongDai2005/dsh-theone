# TheOne v0.1 acceptance report

English | [简体中文](./plugin-v0.1.zh.md)

September 30, 2026. This release delivered an installable DSH plugin. AI Box integration remained future work. This report describes v0.1; see the [current README](../README.md) for later changes.

## Delivery

`dsh-theone@0.1.0` provides a Cordis service, the `theone/gateway` provider, and standard `dsh.bundle.patch` metadata. DSH 0.2.0-rc.2 can install and activate the bundle from `.dsh-test/dsh-theone-0.1.0.tgz` through `plugin add`.

Execution: gateway input → rules / DeepSeek Flash classification → validation and SQLite planning → the context’s dedicated DSH worker → model and tool loop → committed text reply returned to the gateway.

The package includes no real conversation catalog. Without `THEONE_CONTEXTS_PATH`, it starts empty; an explicit first new topic creates a context and worker.

## Implemented

1. Native bundle metadata, installation settings, isolated test profile, and packaging checks.
2. `theone_search_history`, registered only for its worker. Caller identity binds the target; the model cannot select another project. Full DSH logs are projected to text before returning approved windows, including non-contiguous ranges.
3. `theone_update_state`, storing short progress notes and event references while preserving project identity. Oversized notes and common credential patterns are rejected.
4. Reuse of successful DSH compaction summaries, retaining summary/end sequence numbers with redaction and length limits. Each checkpoint is applied once; progress notes remain separate.
5. Recent gateway messages recover after reconstruction by querying DSH. SQLite stores gateway references without duplicating full conversations.
6. Worker creation/restoration initializes DSH model selection and inherits the gateway’s working-directory metadata. This fixes real CLI prompt assembly with `{{cwd}}`.
7. API failure cooldown and routing metadata, including model, duration, token counts, and error codes.

## Validation

Type checking and builds passed. All 41 tests passed. Native `plugin add` / pnpm installation activated the local archive without dependency overrides. Real-model tests used DeepSeek Flash Chat Completions for routing and DSH’s `deepseek-official/deepseek-flash` Messages adapter for workers.

| Real CLI scenario | Result |
| --- | --- |
| Mount a GPU project and save a test marker | MOUNT, completed |
| Switch to a paper project with another marker | SWAP, completed |
| Return to the GPU project and recall its marker | SWAP, completed; no paper marker in the reply |
| Search GPU project history through the tool | KEEP, completed; paired tool calls/results verified source isolation |
| Create a houseplant project | CREATE, completed |
| Restore the same gateway in a new process and continue houseplants | KEEP, completed |
| Start an English-learning project with no catalog file | CREATE, completed |

These calls ran in a private DSH home and empty working directory, with only two TheOne metadata tools allowed. Logs confirmed no other tool execution. The original DSH profile, credential files, and history were unchanged. Each CLI turn used a new process, also testing persistent worker recovery.

Additional tests covered worker-only tools; rejection of attempts to access another context through an extra context ID; range boundaries, broken sources, Chinese matching, excerpt limits; progress recovery and evidence references; and reuse, redaction, and idempotency after real DSH compaction.

An initial tool-result check incorrectly used a nonexistent `toolName` field. Verification was corrected to pair `toolCallId` with `tool/call`, and original test logs confirmed successful execution independently of the model’s final reply.

## Scope at v0.1

This was text CLI acceptance. Web UI, tool approvals/cards, live token streaming, images, automatic history import, multi-mount, and automatic worker rollover were pending. The model updates progress on demand; it is not guaranteed each turn.

The earlier 94.9% AI Box result came from retrospective routing over 79 real history samples with a manual catalog. This release tested plugin behavior without remeasuring live routing accuracy. TheOne had not been deployed to AI Box.
