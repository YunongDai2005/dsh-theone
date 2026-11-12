# The One — shared work, clear ownership

The One is an odd name for a project about letting more people keep their own records. That tension is the idea.

Mia knows what she promised the design client. Leo knows what the moving job needs. Alex is responsible for the studio’s finances. Each person should be able to record their part, in their own conversation, without handing over ownership of it. An LLM helps connect those scattered inputs to the right project. The source, owner and confirmations stay attached as the record takes shape.

“The One” is what the team can come back to: a shared account of what happened, with everyone’s part still visible. Here, we are trying that idea with something concrete: invoices.

**TheOne Invoice Desk — Studio Edition** lets teammates prepare bills together and gives finance a clear place to review them before anything reaches PayPal.

[PayPal AI Hackathon project](https://devpost.com/software/theone-invoice-desk) · [Studio setup and permissions](STUDIO.md) · [Real integration receipt](evidence/studio-live-2026-11-13.json)

## A bill, a detour, and three people

**Mia starts with 480 EUR for website assets.** Then she remembers 72 EUR of moving expenses and records it in Studio expenses. That becomes a note in the right project; her design invoice stays at 480 EUR. When she comes back and changes it to 520 EUR, it is still her draft, with the earlier amount there to compare.

**Leo has his own work.** He prepares a 120 EUR moving-services draft in a project he can access. His conversation keeps its own context. Mia’s design project is outside his permissions.

**Alex brings the bills together for review.** The shared ledger shows who prepared each one. Alex checks Mia’s exact 520 EUR revision, approves it, and creates an unsent PayPal Sandbox draft. The app reads it back to check the result. A later change to 550 EUR needs another review and updates that same PayPal draft. Mia can see the result and Alex’s actions; Alex’s approval does not make the bill his.

That is the thread we want to preserve: someone records something, it finds the right project, and the team can follow what changed and who confirmed it.

## What we mean by decentralized recording

Decentralized recording is the direction: let people contribute from their own context, keep ownership visible, and build a shared record through explicit confirmation. The LLM helps connect the inputs; people and permission checks determine what can happen next.

Today’s prototype runs on **one self-hosted workspace server and one configured PayPal Sandbox merchant**. Contribution and conversation context are distributed across members; the infrastructure remains a single workspace. This is not P2P synchronization, a blockchain, or distributed consensus.

The recorded example uses synthetic studio members and test invoices, with genuine model and PayPal Sandbox requests. It sends no invoice email and makes no payment. You can also try the whole workflow offline with simulated providers.

## Try the studio

<details>
<summary><strong>Run the complete offline preview</strong></summary>

Requires **Node.js 24+**. The application has no npm dependencies or installation scripts.

```sh
git clone --branch codex/hackathon-paypal-ai https://github.com/YunongDai2005/dsh-theone.git
cd dsh-theone/examples/paypal-topic-invoices
npm run studio:init
npm run studio:preview
```

Open `http://127.0.0.1:3074`. Initialization prints random passwords once and saves only salted hashes in ignored `.data/studio-config.private.json`. Keep the passwords private. Sign out and sign in to switch members, or use separate browser profiles for simultaneous sessions.

| Account | Role | Projects |
| --- | --- | --- |
| Mia | Member | Design client, Studio expenses |
| Leo | Member | Moving project, Studio expenses |
| Alex | Finance | All three configured projects |

The preview uses real session and permission code with **scripted model responses and simulated PayPal**. Its banner identifies this. It makes no external requests. Preview records use `.data/studio-preview`; the simulated remote invoice store lasts only for that process.

</details>

<details>
<summary><strong>Use genuine model and PayPal Sandbox APIs</strong></summary>

```sh
cp .env.example .env
# Fill the configuration locally, then:
PORT=3074 npm run studio
```

Set these values in `.env`:

```dotenv
PAYPAL_SANDBOX_CLIENT_ID=<existing Sandbox application client ID>
PAYPAL_SANDBOX_CLIENT_SECRET=<existing Sandbox application secret>
SANDBOX_RECIPIENT=<existing Sandbox buyer test email>
MODEL_BASE_URL=https://opencode.ai/inference/go/openai/v1
MODEL_NAME=deepseek-v4.1-flash
MODEL_REASONING_STYLE=openai
MODEL_API_KEY=<your existing provider key>
```

The model configuration above was used in the current genuine run. Other trusted OpenAI-compatible providers can be configured separately; compatibility and available quota must be verified for that provider. The model receives synthetic messages and project context, not configured recipient addresses. No key or provider allowance is supplied by the repository.

Use **Sandbox credentials and test recipients only**. PayPal requests are fixed to `https://api-m.sandbox.paypal.com`; there is no Live-host option. The real studio stores records in `.data/studio-live`. `THEONE_STUDIO_CONFIG`, `THEONE_STUDIO_DATA` and `THEONE_TOPICS_FILE` can select private local files. Project membership must match the configured catalog. See [account provisioning and migration limits](STUDIO.md).

This is a locally runnable build, not a public hosted service. Judges can run the full offline UI and tests without credentials. To reproduce genuine inference and PayPal operations, configure their own existing provider and Sandbox access as above. The recorded run is evidence of actual integration, not a promise of public hosting or free API access.

</details>

<details>
<summary><strong>Follow the seven-step judge walkthrough</strong></summary>

1. Sign in as **Mia**. Request `Draft a 480 EUR invoice for the design client for website assets.` The draft belongs to Mia and has no remote invoice yet.
2. Record `Record 72 EUR of moving expenses in Studio expenses. Do not create an invoice.` The expense becomes a note; the design draft remains 480 EUR.
3. Request `Back to the design client. Change the 480 EUR invoice to 520 EUR.` The same proposal becomes revision 2. Mia can edit her local draft but has no PayPal creation control.
4. Sign in as **Leo**. The design project is unavailable. Request a separate 120 EUR moving-services invoice in Moving project.
5. Sign in as **Alex** and open **Bills**. Select Mia’s 520 EUR invoice, inspect the changes, then choose **Create Sandbox draft** once. The app verifies the remote unsent draft against the reviewed fields.
6. Use **Update draft** to prepare 550 EUR, inspect the second review and apply it. The existing remote invoice is updated and read back; no email is sent.
7. Ask for the design client’s invoice status. The answer reflects the shared verified 550 EUR record, even though Alex did not propose it. Sign back in as Mia to see the result and Alex’s audit entries.

The account and invoice inputs above are synthetic. The genuine recording uses one existing Sandbox merchant and the same test buyer for both invoice-enabled projects; it does not demonstrate routing across different merchant or buyer accounts.

</details>

## Implementation, evidence, and limits

<details>
<summary><strong>How routing, ownership, and permissions work</strong></summary>

A small studio can prepare invoices together while keeping each member’s conversation context and financial permissions separate. Members propose bills in their assigned projects. Finance reviews the exact revision before the app creates an **unsent PayPal Sandbox draft**, then reads it back and checks the recipient, project, line and total.

Mia can request a 480 EUR design invoice, record an unrelated 72 EUR expense, and return to change the original invoice to 520 EUR. Leo has his own routing state and a different project ledger. Alex, the finance reviewer, sees the authorized shared records and can approve Mia’s latest revision without becoming its owner.

The router selects a project from the signed-in member’s permitted catalog. The planner prepares a local proposal. The server independently checks customer binding, amount provenance, ownership, role, revision and approval digest. A model cannot grant access, choose an arbitrary recipient or approve a PayPal operation.

Each member has a separate SQLite conversation and pending clarification. Studio project views share authorized messages and invoices, not a combined model conversation. Studio removes cross-project reference context from invoice planning and filters teammates’ private routing traces and inaccessible historical revisions. Status answers use the authorized team ledger with separate totals for each currency.

</details>

<details>
<summary><strong>Verification: tests, browser checks, and actual API requests</strong></summary>

- **108 automated tests passed** on the final source. These include 15 independent Studio security scenarios and use mocked external providers. They cover project and owner access, forged identity fields, per-member context, stale approvals, replay, remote lifecycle, history privacy, and HTTP session/CSRF/Origin protections.
- **[14 browser checks passed](evidence/studio-ui-2026-11-13.json)** with simulated providers: member login and project isolation, shared owner labels, finance review, remote edit confirmation, polling, dark/light themes, mobile layout and keyboard focus.
- The [current genuine Studio browser run](evidence/studio-live-2026-11-13.json) completed five model-backed turns using **10 actual OpenCode Go requests** and **6 actual PayPal Sandbox requests**. It created one unsent invoice at 520 EUR and updated that same invoice to 550 EUR with verified read-back. The other member’s 120 EUR draft remained local.
- A separate [real Sandbox recovery run](evidence/sandbox-2026-11-12.json) passed five steps using 12 requests: create a 1.00 EUR test draft, deliberately lose its response, recover by invoice-number search, update to 1.01 EUR, read status, and verify deletion. It sent no email and made no payment.
- Earlier [real model evaluation](LIVE-MODEL-2026-11-12.md) and [repair findings](AUDIT-REPAIRS-2026-11-12.md) remain available as dated evidence, not production accuracy estimates.

```sh
npm test
npm run verify:backend -- backend-evidence.private.json
# Optional browser regression for the original single-user UI; requires Playwright:
npm run verify:ui
# Explicit real Sandbox probe: creates, updates and deletes its own tiny test draft:
npm run verify:sandbox -- .data/sandbox-verification.json
```

`verify:backend` runs sixteen HTTP/SQLite steps with simulated providers against the original single-user app. `verify:ui` accepts `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH` for an existing browser-test installation. The actual application needs neither Playwright nor an npm install.

</details>

<details>
<summary><strong>Current scope and implementation limits</strong></summary>

Studio distributes invoice preparation across members. It still has **one self-hosted workspace server and one configured Sandbox merchant**. P2P synchronization, blockchain settlement, automatic splits, payouts, remote team hosting and merchant onboarding are outside this prototype. Account administration is host-side configuration; there is no invitation or password-recovery service.

Finance controls cover unsent-draft creation, update, deletion, read-only status and separately reviewed share-link publication. Publication makes a Sandbox invoice payable through its link with recipient and merchant email notifications disabled. It does not pay the invoice. The recorded run does not publish a link. There are no payment, refund or capture operations.

The application binds to loopback and checks Host, Origin, sessions and CSRF. It is not a hardened public multi-tenant service. A remote deployment would require deployment-specific authentication, transport, operations and security work. Other current limits are one invoice line, USD/EUR/GBP, exact amounts from 0.01 to 10000.00, and no taxes or customer email delivery.

The original single-user page remains available through `npm start` (default 3047) and `npm run preview` (default 3071). Studio uses its own page and authorization wrapper around the same invoice workflow. [Backend contracts](BACKEND.md), [routing adaptation](ROUTING-046.md) and [frontend merge record](FRONTEND-MERGE-2026-11-12.md) document these layers.

</details>

<details>
<summary><strong>Project history, demo disclosure, and license</strong></summary>

The base TheOne repository began September 30, 2026. The standalone PayPal adaptation was built October 11, and the existing Devpost entry 1231924 was submitted October 12. The November 12–13 update adds the v0.4.6 routing adaptation, backend repairs, redesigned interface and Studio collaboration. It does not mount DSH workers or access original DSH conversations. The repository base remains v0.4.5; this is not a new release of the complete DSH plugin.

Codex assisted implementation, review, tests, documentation and demo preparation. The current English video contains edited recordings of real browser interactions, synthetic scenarios, synthesized narration and captions. Waiting may be shortened and result frames held. No company, customer adoption, revenue, award or production accuracy is claimed.

MIT, inherited from the repository’s root `LICENSE`.

</details>
