# TheOne topic notes — Flow State experiment

Branch: `codex/hackathon-flow-state`.

TheOne already routes a single main chat into independent topic sessions. This
experiment adds a small notes workspace for each topic and an ArmorIQ check before
the worker can use it. A worker can read and write its own notes. If it tries to
read another topic's notes, ArmorIQ rejects the action before the tool runs.

## Current status

- Implemented: DSH pre-execution hook, topic-scoped captured plans, server
  verification through `@armoriq/sdk@0.6.10` (default), optional pinned-key local
  verification, SQLite notes and decision audit.
- Tested: actual DSH routing, worker tool dispatch and main-chat result mirroring
  with a fixture model and a local Ed25519 issuer. Own-topic writes succeed;
  cross-topic reads/writes do not execute; invalid signatures and issuer failures
  deny access; expired tokens are renewed; cancellation is preserved.
- Server-mode fixture tests also check remote allow decisions and fail-closed
  behavior when the enforcement endpoint returns HTTP 500.
- Live service checked October 10, 2026 UTC: real account, API key validation and
  plan token issuance succeeded. Local verification is unavailable because
  `/iap/public-key` returns `enabled: false` and no Ed25519 key. Server enforcement
  currently blocks own-topic actions with `no_matching_policy`. The official CLI
  accepted a restricted two-action policy draft, but activation returned HTTP 500.
  A successful end-to-end cloud integration is **not yet claimed**.
- Pending: resolve service policy activation, repeat live allow/block checks,
  record a real-model demo video, obtain registration approval and finally submit.
  Local issuer tests are **not** evidence of a working cloud integration.

## How the boundary works

The caller's topic comes from the DSH agent session ID matched to TheOne's stored
worker session, not from model arguments. The operator authorizes exactly two
actions per topic: read and write. Their action names include a SHA-256 digest of
the topic ID. The same tools targeting another topic produce action names that
were never declared in this worker's captured plan. In the default server mode,
the SDK rejects undeclared actions and sends declared actions to ArmorIQ's
enforcement service. Optional local mode verifies Ed25519 signatures against a
trusted public key before enforcing the plan. A model call cannot add actions.

The note body checks ownership again and uses parameterized SQLite statements.
There are no model-selected filesystem paths. The audit records the worker,
owner, target, action and decision, without note contents, API keys or tokens.

This addon intentionally restricts TheOne topic workers to the notes tool.
Terminal, browser, history and other tools are not included in its plans. It is
a narrow working experiment, not a claim of a complete DSH sandbox. Ordinary DSH
agents remain outside this addon. An allowed decision continues through DSH's
existing approval hooks; it does not automatically grant user approval.

## Install and check

Use Node.js 24 or later, clone this branch, then:

```sh
npm ci --ignore-scripts
npm run build:armoriq
npm run test:armoriq
```

`build:armoriq` compiles the server addon and its TheOne dependencies. A clean npm
install currently exposes pre-existing client session API type mismatches in the
base v0.3.31 UI (`src/client.ts`); the normal whole-project build is not claimed
to pass with that dependency set. This branch does not change the UI API.

Enable the addon separately from the normal TheOne plugin in a compatible DSH
profile:

```yaml
- id: theone-armoriq
  name: dsh-theone/armoriq
  config:
    userEmail: !!js process.env.ARMORIQ_USER_EMAIL
    databasePath: !!js process.env.THEONE_ARMORIQ_DATABASE_PATH
    apiKeyEnv: ARMORIQ_API_KEY
    validitySeconds: 300
    verificationMode: sdk
```

Set `ARMORIQ_API_KEY` to a real ArmorIQ key, `ARMORIQ_USER_EMAIL` to the real end
user's email, and `THEONE_ARMORIQ_DATABASE_PATH` to an absolute local database
path. Keep secrets outside the repository. Enabling the addon without a key
fails at startup. Issuance or verification failure denies the tool call. The
operator must also configure a matching notes-only policy in their ArmorIQ
workspace; a captured plan alone does not grant service policy permissions.

Run `npm run verify:armoriq` to obtain real issuer evidence: own-topic read/write,
cross-topic read/write attempts and a terminal attempt. It has no fixture
fallback, and exits with failure unless every expected decision is observed.
It verifies the guard; the final video must additionally show the agent and DSH
tool chain using it.

## What is new for the event

The base is commit `854dad728bf8e8aa3ede1b75db7bb602eb1ef77a`, an existing MIT
project. The ArmorIQ addon, topic notes tool, audit and associated tests were
started on October 11, 2026 Beijing time (October 10 UTC), during Flow State's
build window. Existing TheOne routing, session persistence and UI are reused.
Codex assisted with implementation and tests. No model, cloud integration or
working demo is claimed solely from generated code.

Official event: https://armoriq.ai/hackathons/flow-state
SDK docs: https://docs.armoriq.ai/sdk/client-initialization
