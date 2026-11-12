# OpenCode Go model evaluation — November 12, 2026

This is genuine inference against **OpenCode Go / `deepseek-v4.1-flash`**, with synthetic customer requests and temporary SQLite databases. No PayPal API method was called. The key was supplied to short-lived child processes through their environment and was not saved in a repository file, command argument or report.

The [official Go endpoint](https://opencode.ai/docs/console/go) is `https://opencode.ai/inference/go/openai/v1/chat/completions`. Requests use this application's own user agent and a stable conversation ID. Quick routing and invoice planning request `reasoning_effort: none`; rechecks retain the provider's thinking default.

## Audit repair verification (latest)

The later audit added failure recovery, invoice provenance validation and planning retry instrumentation. Its first full genuine run passed 7/8 turns: after the client was clarified, the model unnecessarily asked whether to draft the already-requested invoice. Planning now receives explicit `resolvedRequest` context and instructions to continue that local draft request without another confirmation.

The subsequent complete run passed **8/8 turns**, using **16 calls**, **24,470 input tokens**, **1,192 output tokens**, and **63.742 seconds** of summed request time. Its report is `paypal-audit-full-model-final.json`. The earlier 7/8 report is retained as `paypal-audit-full-model.json` (16 calls, 23,872 input tokens, 1,111 output tokens). Audit-phase totals: 32 calls, 48,342 input tokens, 2,303 output tokens. Combined with the earlier debugging below: 72 calls, 106,856 input tokens and 5,401 output tokens. These remain small synthetic checks, not an accuracy estimate.

Latest offline verification is **88 tests and 16 HTTP demonstration steps**. At that model-evaluation checkpoint, Sandbox was not configured. A later independent November 12 run passed the five-step real Sandbox verifier with 12 requests; see [the sanitized receipt](evidence/sandbox-2026-11-12.json). See [the audit repair record](AUDIT-REPAIRS-2026-11-12.md).

## Earlier complete post-fix verification

**All eight turns passed in one complete run on the fixed backend.** This additional run used **16 real model calls**, with 23,888 input tokens and 1,093 output tokens reported. Summed request time was 38.432 seconds; there was one routing recheck and no retry. No new functional issue was observed in this sample.

| Turn | Verified behavior |
| --- | --- |
| 1 | Create one local 480.00 EUR design draft, with the configured recipient and REVIEW state |
| 2 | Record the 72 EUR moving-expense note under household budget; leave the design draft unchanged |
| 3 | Revise that same draft to 520.00 EUR, revision 2; preserve its service and recipient |
| 4 | Answer invoice status using the stored total of 520.00 EUR awaiting review, without mixing the expense |
| 5 | Create a separate 120.00 EUR consultation draft; preserve the original 520.00 EUR draft |
| 6 | Select the 520.00 EUR draft and revise it to 550.00 EUR, revision 3; keep the other draft at 120.00 EUR, revision 1 |
| 7 | Ask which client the new request means; create no draft while the customer is unclear |
| 8 | Use the explicit client answer to prepare the original 480.00 EUR request in the correct project |

All eight replies were English. The verifier now retains the complete local draft ledger after each turn and checks that unrelated drafts, amounts, currencies, recipients, descriptions and revisions remain intact. It also records SHA-256 fingerprints for the tested backend files, verifier and frozen frontend; the fingerprints match the reviewed files.

Raw evidence: `paypal-live-full-postfix.json`, in the local review artifacts. The normal preview database was not used or modified by this run. The backend behavior did not need another change; this run strengthened the verifier and completed the missing end-to-end check.

## Earlier debugging and subsequent verification

| Stage | Real calls | Observed result |
| --- | ---: | --- |
| Initial eight-turn scenario, stopped on first failure | 14 | First six turns passed; turn seven incorrectly guessed the design client for an unspecified customer. Turn eight did not run. |
| Customer-binding retest plus explicit-client control | 6 | All three business checks passed. Inspection found Chinese clarification and draft text in an English conversation; this run did not yet assert output language. |
| Focused clarification/answer retest | 4 | Both business checks and English-output checks passed. |
| Complete post-fix eight-turn run | 16 | All eight business and English-output checks passed, with the full invoice ledger checked after every turn. |

**Cumulative total across debugging and complete verification: 40 inference requests; 58,514 input tokens and 3,098 output tokens reported.** Summed request time was 139.262 seconds. The latest complete run accounts for 16 of those requests; the earlier debugging phase used 24. Every request reported input/output usage, and no retries were needed. Cache-token fields were not captured from these responses; aggregate zeroes should not be interpreted as no caching. No monetary cost is estimated from these records.

The six successful initial turns covered: a 480 EUR design invoice, a 72 EUR personal moving expense kept in the household budget, revising the original invoice to 520 EUR, reading its status from local records, creating a separate 120 EUR draft, and selecting the 520 EUR draft for a change to 550 EUR without modifying the other draft.

The failure led to two changes:

- A server-owned customer check now prevents an invoice request with no active client or explicit configured project name/alias from accepting a guessed customer. It asks before the invoice planner runs. Generic service wording does not bind a recipient. The original amount and service remain attached to the pending question for the explicit client answer.
- Customer-choice questions, draft-prepared messages and revision outcomes use authoritative English backend text. The model cannot claim that a locally prepared draft has already been sent. The model prompts also require English output. Database-backed status replies were already deterministic.

The final real exchange was:

> User: Draft a 480 EUR invoice for that client for project services.
>
> App: Do you mean Design client or Moving project? Please name the project.
>
> User: The design client.
>
> App: Draft prepared for review. Check the client, recipient and amount before creating it in PayPal Sandbox.

The resulting local draft was 480.00 EUR in the design project, in REVIEW state. The first turn used quick routing plus recheck; the answer used quick routing plus invoice planning.

## Earlier evidence boundaries

The complete eight-turn scenario **passed after the fixes**. The final revision also has **68 passing offline tests**, rerun during this verification, and the previously completed **11-step local HTTP demonstration** with simulated providers. This small sample establishes working integration and the observed behaviors; it is not a general routing-accuracy estimate, a customer study or current live PayPal verification. The existing October PayPal evidence remains historical.

The frontend is unchanged from its archived hash. The normal preview remains explicitly simulated; the test key was not installed in the long-running preview. No commit, push, deployment or competition update was made.

## Reproduce with a local credential

Use `MODEL_BASE_URL=https://opencode.ai/inference/go/openai/v1`, `MODEL_NAME=deepseek-v4.1-flash`, `MODEL_REASONING_STYLE=openai` and a locally supplied `MODEL_API_KEY`. Then run:

```sh
node --env-file=.env verify-live-model.mjs live-evidence-model.json
```

The default scope is eight turns with a hard cap of 24 calls. `MODEL_TEST_SCOPE=customer-binding` selects three turns; `clarification-only` selects two. `MODEL_MAX_CALLS` can lower the budget to 1–24. The verifier stops on a failed business or English-output assertion. Its English check detects CJK script regressions; it is not a universal language detector.
