# TheOne Invoice Desk — PayPal Sandbox adaptation

**Submitted October 12, 2026: [TheOne Invoice Desk](https://devpost.com/software/theone-invoice-desk), PayPal AI Hackathon entry 1231924.** The submission was confirmed in the event UI and by the organizer's confirmation email. This is submission evidence, not a prize or shortlist result. One chat proposes a project and invoice line; the user reviews the project, configured Sandbox recipient and amount, then requests an **unsent PayPal Sandbox invoice draft**. Each project's draft ledger persists in a separate SQLite query scope.

This is a standalone experiment inspired by TheOne's topic workflow, built October 11, 2026. It does not mount the original DSH workers, read DSH logs or modify the main plugin. The existing TheOne repository began September 30; this adaptation reuses its MIT repository infrastructure, not previous competition demos as PayPal evidence. Codex assisted implementation, tests and documentation. No company, revenue, customer usage, award or measured production routing accuracy is claimed.

## Source and demonstration versions

On October 25 the repository's base plugin was upgraded to TheOne **0.4.1**, using release commit `5e6f4e9b190c7773d080885bcdcbe02e033e2ffe`. Invoice Desk remains the standalone Sandbox application described here; it does not acquire the DSH plugin's new topic-choice controls through this merge. Its invoice implementation and October 11 evidence are unchanged. The existing 96-second video was made before this upgrade and is not a 0.4.1 plugin demonstration. Local verification for this update uses mocked provider responses, with no new live invoice or model call.

## Run

Node.js **24+**, no npm dependencies or installation scripts:

```sh
git clone --branch codex/hackathon-paypal-ai https://github.com/YunongDai2005/dsh-theone.git
cd dsh-theone/examples/paypal-topic-invoices
cp .env.example .env
# Fill .env locally as described below.
npm start
```

Open `http://127.0.0.1:3047`. The UI shows whether model and Sandbox credentials are configured; unavailable actions are disabled. It binds only to loopback and is a single-owner local app, not an authenticated multi-user service.

1. Use your existing [PayPal developer account](https://developer.paypal.com/) and its **Sandbox** app credentials. Put them in `PAYPAL_SANDBOX_CLIENT_ID` and `PAYPAL_SANDBOX_CLIENT_SECRET`. Never enter Live credentials. PayPal's [OAuth flow](https://developer.paypal.com/api/rest/authentication/) obtains the access token server-side.
2. Set `SANDBOX_RECIPIENT` to a buyer's **test email from your Sandbox dashboard**, never a real customer. Built-in `example.invalid` addresses only describe synthetic topics; replace them before live Sandbox validation. For distinct test recipients, create an ignored `topics.private.json` array of objects with `id`, `title`, `summary`, `recipient` and optional `invoice_enabled:false`, then set `THEONE_TOPICS_FILE`.
3. Configure a trusted OpenAI-compatible model provider with `MODEL_BASE_URL`, `MODEL_API_KEY` and `MODEL_NAME`. The model receives synthetic input and topic descriptions, **not the configured recipient addresses**. For Nebius Nemotron, set `MODEL_DISABLE_THINKING=true`; omit this option for incompatible providers. Inference uses your provider quota. No paid subscription is required by this app.
4. Keep credentials, test emails, databases and raw API evidence private. `.env`, `.data/` and the supplied private catalog filename are ignored. Use synthetic messages for demonstrations.

## Workflow

- “Draft a 480 EUR invoice for the design client for website assets.” makes an actual model call. Strict JSON validation produces a local **REVIEW** card; no PayPal request occurs yet.
- The review card shows the exact amount, currency, line name and recipient. “Correct project” changes the topic and configured recipient and invalidates the previous review digest.
- “Create reviewed Sandbox draft” claims the local proposal once, obtains Sandbox OAuth, and calls [create draft invoice](https://developer.paypal.com/api/invoicing/v2/invoices-create). The app then [reads the draft](https://developer.paypal.com/api/invoicing/v2/invoices-get), checks DRAFT status and the reviewed topic reference, recipient, line and total before reporting success.
- Reloading preserves the ledger. Replaying approval on an already verified proposal returns its existing invoice ID. Concurrent approval cannot create twice.
- A timeout, process interruption or unexpected remote result does **not** trigger another create. An uncertain attempt with a known remote ID can be reconciled using a read only. If the ID is unknown, inspect the Sandbox dashboard using the displayed unique invoice number; there is intentionally no retry-create control.
- Only USD/EUR/GBP and exact amounts from 0.01 to 10000.00 are supported. Household budget is a notes-only topic and cannot create customer invoices. Non-invoice chat currently returns a short model routing explanation; it is not a persistent conversational assistant or general expense ledger.

There are **no send, pay, capture, payout, refund or payment-record methods**. A draft is not payable until separately sent by PayPal; this app never does that. Sandbox endpoint is fixed in code; response URLs and redirects are never followed with credentials. Host/Origin checks and a per-process browser token protect local mutations, but this is not a security audit. Restarting invalidates the browser token; reload the page.

## Verification and limits

```sh
npm test
# Real model smoke check only, no PayPal operation:
node --env-file=.env verify-live-model.mjs live-evidence-model.json
```

The tests exercise SQLite persistence and actual local HTTP calls, but **all model/PayPal responses in tests are explicitly mocked**. Passing them does not establish cloud integration. The real model script stops on service failure and writes private evidence; three synthetic messages cannot establish general accuracy.

On October 11, genuine Nebius `nvidia/nemotron-3-super-120b-a12b` calls returned a design invoice proposal (480 EUR) and a clarification for an underspecified invoice request. On the third synthetic message, explicitly asking to put a moving expense in the monthly budget without creating an invoice, the model asked an unnecessary clarification instead of choosing the budget topic. All three responses passed structural validation; this is functional API evidence and a known routing limitation, not a production accuracy estimate. Earlier schema-debug calls exposed an empty explanation on an otherwise valid invoice proposal; invoice explanations may now be empty while all execution fields remain validated. Chat and clarification explanations still must be nonempty. Raw responses remain private outside Git.

On October 11, a fresh synthetic 480 EUR design invoice was proposed through the actual Nebius model, reviewed in the browser, created through the existing PayPal Sandbox application and read back as `DRAFT`. The workflow checked its project reference, test recipient, line and total. A separate authenticated read confirmed those fields again. Replaying approval returned the same invoice ID without any remote call or additional local proposal. The demo configuration uses one existing Sandbox buyer for its invoice-enabled topics, so this check does not establish isolation between distinct buyer accounts. Sanitized evidence is in `evidence/sandbox-smoke.json`; raw responses, account identifiers and credentials remain private. No invoice was sent and no payment operation occurred.

The [96-second public PayPal demonstration](https://youtu.be/dtGlTcxWuwA) was included in the confirmed October 12 submission. It uses actual October 11 browser screenshots with English captions and edited holds; it is not a continuous real-time screen recording. The first example shows a verified 480 EUR remote Sandbox `DRAFT`. A separate 72 EUR proposal remains in local `REVIEW` after manual topic correction, not a second remote invoice. Both topics use the same existing Sandbox buyer. An ambiguous request is shown being clarified. The video makes no sending, payment, distinct-buyer-isolation or general-accuracy claim. The earlier Nebius video is not PayPal evidence.

The submission discloses the existing TheOne base, new PayPal-specific work, model limitations and Codex assistance. Preserve the existing entry and video rather than creating a duplicate. Documentation status was reconciled with the saved confirmation on October 25; no new invoice or payment operation was run for this update.

MIT, inherited from the repository's root LICENSE.
