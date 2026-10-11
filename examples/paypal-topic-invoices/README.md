# TheOne Invoice Desk — PayPal Sandbox adaptation

**Development branch, not a submitted or cloud-verified PayPal entry.** One chat proposes a project and invoice line; the user reviews the project, configured Sandbox recipient and amount, then requests an **unsent PayPal Sandbox invoice draft**. Each project's draft ledger persists in a separate SQLite query scope.

This is a standalone experiment inspired by TheOne's topic workflow, built October 11, 2026. It does not mount the original DSH workers, read DSH logs or modify the main plugin. The existing TheOne repository began September 30; this adaptation reuses its MIT repository infrastructure, not previous competition demos as PayPal evidence. Codex assisted implementation, tests and documentation. No company, revenue, customer usage, award or measured production routing accuracy is claimed.

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

Sandbox account/app access and genuine invoice creation/read-back remain pending. No working PayPal-cloud video or final PayPal submission exists. Do not present this branch, offline tests or the earlier Nebius video as a completed PayPal integration. Before submitting, complete the genuine Sandbox check, record an end-to-end video under three minutes, and disclose the reused base, new work, model limitations and AI assistance under the [official rules](https://paypalaihackathon.devpost.com/rules).

MIT, inherited from the repository's root LICENSE.
