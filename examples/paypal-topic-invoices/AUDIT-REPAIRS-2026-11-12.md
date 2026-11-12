# Backend audit repairs — November 12, 2026

Worktree: `TheOne-PayPal-preview-20261112`, branch `codex/hackathon-paypal-ai`.
No commit, push, deployment, competition update or frontend edit was made during these repairs.

## Findings and disposition

| Audit finding | Repair and evidence |
| --- | --- |
| 1. OAuth 401 / create 422 permanently lock drafts | Typed PayPal failures distinguish requests never sent or definitively rejected from unknown outcomes. Definite failures return to REVIEW with a new revision/digest. Duplicate-invoice rejection and transport uncertainty remain UNCERTAIN; automatic re-creation stays blocked. Tests cover both recovery paths. |
| 2. No discard, duplicate active drafts | `/discard` removes REVIEW drafts from active totals. Unknown outcomes require explicit acknowledgement and become ARCHIVED_UNCERTAIN, with their history and read-only recovery retained. Identical requests in one project reuse an existing active record even without request IDs. |
| 3. Customer guard bypasses and false positives | Explicit configured customer names/aliases outrank the foreground project. Billing verb forms and Chinese 账单 are recognized. Educational bill questions do not trigger a customer-choice guard. Financial plans receive a second server-side binding check. |
| 4. Invented amounts accepted | Amount/currency must be supported by the current request or the selected project's recent USER messages. Updates use current replacement amounts; assistant text and other projects cannot supply money. Unsupported 480→4800 plans fail before creating a draft. |
| 5. No planning retry or failed-turn evidence | Planning receives the same bounded two-attempt schema validation as routing, including local monetary validation feedback. A separate attempt journal retains redacted user text, errors and call usage even if the conversation transaction fails. Metrics include failed/interrupted attempts and planning calls. |
| 6. Narrow draft selection | Currency symbols, euro/dollar/pound names, reordered English and Chinese selectors work. Replacement values and ambiguous equal-value drafts do not select a target. |
| 7. Amounts count as unique project evidence | Plain numeric totals no longer trigger evidence rechecks. Explicit named projects suppress contradictory clues from other project histories. Alphanumeric references remain usable evidence. |
| 8. No new real Sandbox evidence | **Verified November 12 at 15:41 UTC.** `verify-sandbox.mjs` passed all five steps using 12 real Sandbox requests: one EUR 1.00 draft, controlled loss of its returned ID, invoice-number search/read recovery, update to EUR 1.01, status read and verified deletion. No email, invoice publication or payment occurred. [Sanitized receipt](evidence/sandbox-2026-11-12.json). |
| 9. Thin PayPal lifecycle | Added separately reviewed remote update/delete/publish operations, readback verification, restart-safe read-only reconciliation, and timestamped status/due-amount reads. Publish uses `/send` with both email notification flags false and creates a payable Sandbox link. No payment, refund, capture, automatic email or payment-record endpoint exists. New lifecycle behavior is currently verified with fake HTTP transport, not a real merchant. |
| 10. Frozen UI / old video / no request ID | Frontend remains frozen as requested; new review/history/metrics/lifecycle controls and the public video are **not updated**. Existing chat uses the improved backend. Server-side duplicate-draft prevention now works without a request ID; full inference replay still requires an API client to supply one. |
| 11. Docs / HTTP errors / single uncommitted copy | Demo is documented as 16 steps. HTTP distinguishes malformed requests (400), missing records (404), stale/state conflict (409), rejected fields (422), model/upstream failure (502), configuration/auth problems (503), timeout (504) and unexpected internal failure (500). Independent before/after source archives and an applicable cumulative patch preserve the uncommitted work. Local origin remains unchanged. |

## Verification after repairs

- **88 automated tests passed**, including the original 68 tests with valid grounded fixtures and updated error/metrics expectations. The added audit/lifecycle tests reproduce deterministic failure recovery, archive/discard, no-ID duplicates, money provenance, plan retries/failures, multilingual selectors, remote updates/deletion/publication, restart recovery, stale review, concurrency, status reads and notification suppression.
- **16-step HTTP/SQLite backend demonstration passed.** It creates once under simulated response loss, reconciles by invoice number, updates and deletes the remote fixture, and verifies the frozen frontend hash.
- First genuine eight-turn audit run: **7/8**, 16 model calls. The final client answer caused an unnecessary second confirmation instead of preparing the already-requested local draft.
- After adding explicit resolved-request context to planning: **8/8**, 16 model calls, 24,470 reported input tokens and 1,192 output tokens. Summed API request time: 63.742 seconds. All eight English-output and invoice-ledger checks passed.
- Audit-phase genuine inference total: **32 calls**, 48,342 input tokens and 2,303 output tokens. No real PayPal calls, notifications or payments were performed.

Evidence is stored outside Git in the local review artifact directory:

| File | Meaning |
| --- | --- |
| `paypal-audit-unit-tests.log` | Latest 88-test output |
| `paypal-audit-backend-evidence.json` | 16-step simulated HTTP workflow |
| `paypal-audit-full-model.json` | Preserved first genuine run, including the failed final turn |
| `paypal-audit-full-model-final.json` | Complete passing genuine run with source hashes |
| `paypal-audit-sandbox.json` | Historical pre-configuration checkpoint: NOT_RUN, zero calls |
| `evidence/sandbox-2026-11-12.json` | Later real Sandbox run: five steps passed, 12 requests, exact test draft verified deleted |
| `paypal-before-audit-fixes-20261112.tar.gz` | Source backup before these repairs |
| `paypal-after-audit-fixes-20261112.tar.gz` | Repaired source backup, excluding secrets and runtime databases |
| `paypal-routing-0.4.6.patch` | Cumulative uncommitted changes, applicable to the original base |

Frontend SHA-256 remains `c4bdef50513582e5ef830a7917d916af33e3c581e82697327c8cb9952f493600`.
Git HEAD remains `8652fdce883348f1156d9266f6c6b554e419dc47`.

## Run real Sandbox verification

Fill the ignored local `.env` with `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, and a **test buyer** `SANDBOX_RECIPIENT`, then:

```sh
npm run verify:sandbox
```

The verifier uses only the fixed PayPal Sandbox host. It does not publish the invoice or call the model. The evidence and recovery database default to ignored `.data/`. Cleanup only targets the exact synthetic invoice created by that invocation; failed cleanup is recorded for manual inspection by invoice number.

This remains a local, single-owner workflow: run one server per database. Status snapshots are timestamped observations, not continuous webhook synchronization. The original October PayPal evidence and public video remain historical. A current merchant integration run and a later frontend/demo update are still needed for a fully demonstrated competition submission.

Official API references used: [full update](https://developer.paypal.com/api/invoicing/v2/invoices-update/), [send without recipient email](https://developer.paypal.com/api/invoicing/v2/invoices-send/), [invoice lifecycle](https://developer.paypal.com/api/invoicing/v2/).

## Frontend merge follow-up

After this backend-only checkpoint, the user requested merging the new Invoice Desk frontend into this repaired worktree. The old frontend snapshot and its recorded hash above remain historical evidence. See [the merge record](FRONTEND-MERGE-2026-11-12.md) for the active UI, unchanged repaired backend and integrated verification. The old frontend freeze no longer applies to the active `index.html`.
