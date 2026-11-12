# PayPal routing adaptation — November 12, 2026

## Verified release and scope

The reference is **TheOne v0.4.6**, commit `00a552bf6a5dea281543d8d89a346968c05fc692`. The release files were read directly at that tag. The local repository base is still 0.4.5; no upgrade of the whole DSH runtime is claimed.

| Release source | Verified Git blob | Applied here |
| --- | --- | --- |
| [llm-router.ts](https://github.com/YunongDai2005/dsh-theone/blob/00a552bf6a5dea281543d8d89a346968c05fc692/src/llm-router.ts) | `db3a728f67dfb0f4da672a96d4393b48a49d3ee6` | Semantic prompt; bounded JSON parsing; two attempts; usage and latency receipts |
| [routing-evidence.ts](https://github.com/YunongDai2005/dsh-theone/blob/00a552bf6a5dea281543d8d89a346968c05fc692/src/routing-evidence.ts) | `674d5fb08bc428cdf4fbc6d5b59ba148963196e6` | Project-exclusive names, references and numbers trigger a second look |
| [routing-policy.ts](https://github.com/YunongDai2005/dsh-theone/blob/00a552bf6a5dea281543d8d89a346968c05fc692/src/routing-policy.ts) | `6fb0c13333800c55b395125e03b4b8515ea75b44` | Credential redaction and short-continuation policy |
| [routing-bindings.ts](https://github.com/YunongDai2005/dsh-theone/blob/00a552bf6a5dea281543d8d89a346968c05fc692/src/routing-bindings.ts) | `365d0d2f1e1f12be22d367f2a01e35e90703cb77` | Foreground, pending-task conflicts and returning after an aside |
| [index.ts](https://github.com/YunongDai2005/dsh-theone/blob/00a552bf6a5dea281543d8d89a346968c05fc692/src/index.ts) | `a92d537f7d40b6f122226de2905e415e3f07df87` | Quick → optional recheck orchestration; aside skips a create-only recheck |

The full release also has DSH workers, binding provenance, history candidate search with catalog review pages, background work, cross-project checks and automatic settlement of unclear routes. Those are not all transplanted into this small standalone application.

## PayPal-specific decisions

The audience is a freelancer or small business billing several customers while discussing personal expenses in the same conversation. A project owns its configured recipient, conversation, editable drafts and verification history.

1. Route before extracting invoice fields. A stable, redacted catalog and recent messages support the quick pass. Project evidence is computed locally from up to 32 user messages per topic; only the conflicting terms enter a recheck.
2. Recheck a proposed new topic, a clarification, or a conflict with a unique project clue. A one-off aside skips the create-only recheck. Short continuations can skip routing inference after checking foreground and pending state; the invoice planner still runs.
3. Preserve financial ambiguity. The main plugin can settle unclear topics automatically; Invoice Desk retains a customer question. If a conflicting-customer recheck fails, it asks instead of accepting the first target. Routing never grants approval to create an invoice.
4. Use the full local catalog (at most 32 topics). There is no truncated candidate index to review, so the trace explicitly marks catalog review as unnecessary. This is not the plugin's large-history search pipeline.
5. Select edits using a unique invoice number, service name followed by “invoice”/“draft”, or original amount + currency followed by “invoice”/“draft”. “Change the 480 EUR invoice to 520 EUR” uses 480 as the selector. Matching uses every REVIEW draft in that project; an explicitly selected older draft is included in the eight-draft model window. Duplicate matches require clarification.
6. Measure behavior. Every successful routed turn stores the initial/final decision, recheck trigger, attempt counts, reported tokens, cache hits and latency. `GET /routing/metrics` aggregates the last 500 persisted user turns without double-counting assistant replies or request replays. It excludes wholly failed requests and separates uninstrumented scripted turns. It does not estimate accuracy.

Routing gets a shared 60-second deadline; planning gets 40 seconds. Each completion has at most two attempts. Invalid JSON, invalid route decisions, incomplete completions and transient network/5xx failures may retry once. HTTP 4xx, including authentication, billing and rate limits, do not retry. Provider response bodies, reasoning text and credentials are not included in receipts.

## Hackathon criteria and evidence

The [official rules](https://paypalaihackathon.devpost.com/rules), checked November 12, give five equally weighted criteria. Technical implementation is the first tie breaker. PayPal Sandbox must be central; the AI model is the entrant's choice. Judges need a functional build and an end-to-end demonstration.

| Criterion | Contribution of this backend | Evidence / remaining gap |
| --- | --- | --- |
| Technological implementation | Semantic routing with selective rechecks; revision binding; exact PayPal read verification and lost-response recovery | Automated adapter/workflow checks and HTTP demonstration; real model sample tested; current real PayPal still needs validation |
| Design | Return to interrupted work, resolve a specific draft naturally, preserve a reviewable state | Merged Invoice Desk conversation, revision diffs and review panel |
| Potential impact | Prevent mixing a customer's invoice with another customer's work or personal expense | Interleaved synthetic scenario; no measured customer study claimed |
| Innovation / idea | Topic routing governs an auditable invoice workflow, with server-owned customer and revision boundaries | Routing receipts, correction history and version snapshots |
| Presentation | Reproducible normal flow plus lost-response recovery and multi-draft selection | 11-step HTTP demonstration; old public video has not been updated |

These are engineering choices informed by the criteria, not a prediction of judges' scores. The project currently prepares and verifies unsent Sandbox drafts. Customer delivery, checkout and payment collection are outside this build.

## Small genuine-model evaluation

`verify-live-model.mjs` runs eight synthetic turns with a hard maximum of **24 inference requests**, including retries and rechecks. It covers two interleaved projects, revision, database-backed status, selecting between two invoices, and resolving an unspecified customer. It stops at the first failed assertion. All PayPal methods are disabled. Reports contain call metadata, result assertions and token totals, with no API key or reasoning content.

The requested model is DeepSeek V4.1 Flash. The [official model announcement](https://api-docs.deepseek.com/news/news260910/) names `deepseek-flash` as the direct API identifier; a gateway may expose a different identifier. [Official thinking controls](https://api-docs.deepseek.com/guides/thinking_mode/) support the native `thinking.type` setting. Use `MODEL_REASONING_STYLE=deepseek` for that contract, `openai` for a gateway supporting `reasoning_effort=none`, or `none` when neither is advertised. Rechecks retain/enforce thinking while quick routing and invoice planning request it off when configured.

The user identified the supplied key as **OpenCode Go**. The [current official Go documentation](https://opencode.ai/docs/console/go) specifies `https://opencode.ai/inference/go/openai/v1` as the OpenAI-compatible base and `deepseek-v4.1-flash` as the model identifier. This test uses `MODEL_REASONING_STYLE=openai`. Requests identify this application as `theone-invoice-desk/0.4.6`; a stable `x-opencode-session` UUID is created per adapter instance. The credential is passed only through the temporary test process environment, not a shell command argument or repository file.

**Current live-test status: complete post-fix eight-turn run passed.** OpenCode Go / DeepSeek V4.1 Flash used 16 additional calls for all eight business and English checks, including full-ledger assertions, with no new functional issue observed. The earlier 24-call debugging phase found and fixed the unspecified-customer path and mixed-language invoice outcomes. The full run retained its source fingerprints and passed against the current backend. [Full evidence and limits](LIVE-MODEL-2026-11-12.md): this is one small synthetic scenario, not a general accuracy estimate, and no PayPal call was made.
