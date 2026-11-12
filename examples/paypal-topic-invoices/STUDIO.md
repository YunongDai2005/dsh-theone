# The One Studio — shared project billing

Studio adds member accounts and shared project ledgers to Invoice Desk. Contributors prepare their own bills, teammates see the records for projects they share, and a finance member reviews a draft before the app calls PayPal Sandbox.

This distributes the work of preparing invoices. It does **not** decentralize payment settlement: this prototype has one self-hosted studio server, a server-owned ledger, and one configured PayPal Sandbox merchant. It has no blockchain, peer-to-peer synchronization, automatic splits, payouts, or independent merchant onboarding.

## Where routing helps

The router associates a member's request with a permitted project before planning an invoice. The invoice keeps its contributor, project, configured test recipient, amount, revision and activity history. A member can leave a project conversation, discuss something else, then return to an earlier draft without moving its money into the other project.

Routing does not grant access or approve financial operations. The server determines the signed-in member, checks project access and invoice ownership, and enforces finance permissions before an action reaches PayPal. Explicit references to another contributor's invoice cannot silently select the caller's own draft.

Each member has a separate conversation state and pending clarification. The model receives that member's context and permitted project catalog. The project view combines the team's authorized project messages and invoices; it does not merge everyone into one model conversation. A clarification that has not yet been assigned to a project stays with its author.

Project status answers use the authorized **team** ledger, with separate totals for each currency. They describe stored invoice records, not a bank balance or proof of payment. A teammate's private routing trace is not included in the shared message view, and the invoice planner cannot import another project's conversation as a reference into a group-visible answer.

## Start a studio

Use Node.js 24 or later from `examples/paypal-topic-invoices`. No npm dependency installation is needed for the application itself.

```sh
npm run studio:init
npm run studio:preview
```

Initialization creates `.data/studio-config.private.json` and displays random passwords once in the local terminal. Store those passwords privately; only salted hashes are saved in the configuration file. Initialization refuses to overwrite an existing configuration.

Open `http://127.0.0.1:3074`. The initial synthetic accounts are:

| Member | Role | Assigned projects |
| --- | --- | --- |
| Alex | Finance | Design client, Moving project, Studio expenses |
| Mia | Member | Design client, Studio expenses |
| Leo | Member | Moving project, Studio expenses |

Preview has real account authentication and permission checks, but its model and PayPal providers are simulated. It uses `.data/studio-preview`, separate from the genuine-provider data directory. Preview's simulated remote invoice store lasts only for the running process; a saved simulated invoice cannot establish a live PayPal result.

For genuine model and PayPal Sandbox operation, fill the existing local `.env` as described in the main README, then run:

```sh
PORT=3074 npm run studio
```

The live studio uses `.data/studio-live`. `PORT` overrides port 3074; `THEONE_STUDIO_CONFIG` and `THEONE_STUDIO_DATA` select a different local account configuration and data directory. `THEONE_TOPICS_FILE` selects a private project catalog. Member `project_ids` must refer to that catalog's actual IDs. Assign only test recipients and existing Sandbox credentials.

Account administration is currently host-side configuration. Changing roles or password hashes requires a restart and ends existing in-memory sessions. Changing the studio ID, member list, project memberships or catalog IDs while reusing an existing ledger is rejected at startup. Use a new data directory or perform an explicit, reviewed migration; do not delete the ownership fingerprint to bypass the check. There is no automated member invitation, password recovery or access-migration UI in this prototype.

## Permissions

All permissions below also require access to the invoice's project.

| Operation | Member | Finance or administrator |
| --- | --- | --- |
| Read a shared project's messages and invoice ledger | Yes | Yes |
| Prepare a new draft in an assigned project | Yes | Yes |
| Edit or discard an own local draft | Yes | Yes |
| Manually edit a teammate's local draft | No | Yes |
| Create and verify a PayPal Sandbox invoice | No | Yes |
| Review and apply a supported remote invoice action | No | Yes |
| Change another member's account or project access through the web UI | No | No; configuration is managed on the host |

A project correction must remain within the permissions of both the acting member and the original contributor. Moving a draft changes its configured recipient and invalidates the previous review. A member's role is not accepted from a request body or a client-side selector.

Moving an invoice into a shared project does not expose its inaccessible earlier project history. A reader sees only authorized historical revisions and activity; comparisons against a hidden earlier revision are omitted. Original conversation messages with inaccessible project references remain private.

Natural-language editing remains scoped to the contributor's own drafts. Finance can use the explicit invoice review controls to work on another contributor's draft. Remote operations still require a fresh review of the exact fields and revision; a chat message never authorizes them.

## Runtime and data boundaries

Studio wraps the existing `InvoiceWorkflow` rather than replacing its invoice state machine. Each contributor has a separate SQLite workflow database. The studio view combines only the records that the signed-in member is allowed to see. The existing revision checks, request replay handling and remote outcome recovery continue to apply.

Authentication uses salted password hashes and opaque server-side sessions. Session cookies are HttpOnly and SameSite=Strict. Login rotates the session and CSRF token; logout invalidates the old session. API requests require both the session cookie and its CSRF token. Host and Origin checks retain the loopback boundary.

The frontend clears cached records on account changes and rejects late responses from an older session. Hiding a button is only a user-interface convenience: the server enforces the same permission when an endpoint is called directly.

The default server binds to loopback. Multiple browser profiles or private windows on the same computer can demonstrate distinct member sessions. This is not a deployed public team service. Internet deployment would additionally need a reviewed HTTPS/reverse-proxy configuration, secure-cookie policy, account administration, account recovery, operational monitoring and backups.

Keep account configuration, passwords, recipient addresses, runtime databases and provider credentials out of the repository and public video. Configure only Sandbox credentials and test recipients. The model is not given the server-configured recipient addresses.

## Reproducible security checks

The additional `studio-security.test.mjs` tests exercise the real studio wrapper and HTTP server with synthetic model and PayPal adapters. They are not evidence of live cloud calls.

```sh
node --test studio-security.test.mjs
```

The checks cover project-scoped reads and writes, ownership enforcement within a shared project, finance approval of a member draft, stale review rejection, approval replay, project correction restrictions, separate member routing context and request IDs, pending-question isolation, explicit foreign invoice references, persisted ownership, session rotation and logout, forged actor fields, and CSRF/Origin/Host rejection before provider activity.

The original invoice tests remain relevant and should run alongside the studio suite:

```sh
npm test
```

## Demonstration sequence

1. Sign in as a contributor assigned to the design project. Request a synthetic 480 EUR invoice for website assets. Verify that the draft names the contributor and remains awaiting finance review.
2. Open another browser profile or private window as a different contributor. Work in that member's assigned project. Check that the first contributor's pending question and private projects do not appear.
3. In a shared project, show the teammate's invoice as readable, with editing and PayPal approval unavailable to an ordinary member.
4. Sign in as finance. Review the contributor, project, configured test recipient, service and amount. If needed, revise the draft and inspect the changed fields before approving the latest revision.
5. Create one unsent Sandbox invoice. The app reads it back and verifies the reviewed fields. Repeating approval returns the existing result rather than creating another invoice.
6. Reload the studio and confirm that ownership, revisions and the verified result persist.

The example names and requests used for the demo are synthetic. Offline preview uses scripted providers and labels them as simulated. Only a separately recorded run with genuine model and PayPal responses establishes live integration. Automated passing checks do not establish production readiness or a general routing-accuracy score.
