# TheOne Topic Taste — Qloo adaptation in progress

One chat for different plans, with separate confirmed favorites for each topic. A family weekend's taste should not silently become a solo movie night's taste.

**Status, October 12, 2026:** source implementation and ten offline integration tests are complete. The Qloo hackathon key has been requested but not received. No live Qloo search/recommendation, hosted judge demo, public demonstration video or final Qloo submission has been verified. The web preview explicitly reports this state. Tests use invented responses and are not model scores or evidence of a working cloud integration.

This is a standalone Node.js adaptation of TheOne's one-chat/per-topic design. It does not require DSH and does not claim to run the original DSH routing implementation. The original plugin remains unchanged on this branch. New Qloo-specific work started October 12, during the official September 30–October 30 build period. The existing MIT project and Codex assistance must be disclosed in the entry.

## What the implementation does

- A language model plans a search, recommendation or clarification, choosing a known topic or proposing a clearly distinct new one. Its catalog contains only topic IDs/titles, never favorites from other topics.
- Search resolves a favorite through Qloo. The user chooses the exact candidate before it becomes a persistent preference. A model/client cannot invent a saved entity ID; a five-minute server-side search token binds candidates to the browser and topic.
- Recommendations use only the selected topic's confirmed entity IDs. They may cross categories: a favorite movie can inform book or music picks. Results come from Qloo; no model-generated substitutes or fabricated explanations appear if the API fails.
- SQLite persists topics and preferences. An opaque HttpOnly browser cookie scopes ownership; every topic read/write checks it. This is a browser workspace, not a multi-device account or an identity-verification system. Clearing cookies loses access to that workspace.
- Keys stay on the server. JSON requests reject a different browser Origin, response text uses textContent, and upstream redirects are refused. Hard process-wide Qloo/model budgets and per-browser request limits bound demo use. No paid-resource provisioning is included.

## Run locally

Requires Node.js 24 or newer. No npm dependencies or install step.

```sh
cd examples/qloo-topic-taste
cp .env.example .env
# Fill only legitimately issued Qloo and model keys. Never commit this file.
node --env-file=.env server.mjs
# http://127.0.0.1:3057
node --test test/*.test.mjs
```

The default database is `.data/taste.db`, excluded from Git. `TASTE_DB` can point to private persistent storage. The model endpoint defaults to Nebius's OpenAI-compatible API and Nemotron; the same validated plan interface supports a configured compatible endpoint. Neither model quality nor live operation has been measured for this adaptation yet.

Without keys, manual topic creation works and live operations report unavailable. There is no fixture mode in the running app.

## Verify the real service after the key arrives

```sh
node --env-file=.env verify-live.mjs
```

This makes bounded real Qloo search/recommendation requests for two synthetic-use-case topics and real model routing calls. It requires exact title matches, nonempty recommendations, correct per-topic request signals and a new-vs-existing route. It fails if any dependency is missing; it never swaps in fixtures. Standard output contains only validation summaries, not Qloo response dumps or credentials. Save detailed private evidence outside Git if needed.

The script is a cloud integration gate, not a routing accuracy benchmark. Before a contest video, also validate a real browser search/confirmation/recommendation journey, service errors and an alternate browser's isolation. Keep the demo accessible through November 16 judging, not just during recording.

## Hosting preparation

The Dockerfile runs the same Node server on port 7860 with no external package install. Deployment is **not done**. Choose a free, legitimate hosting service and confirm its actual terms and secret-storage permission at deployment time. Use HTTPS and a trusted proxy that supplies `X-Forwarded-Proto`; expose no database files or provider keys. A host without a persistent disk can reset favorites on cold restarts; disclose that limitation rather than promise durable storage. Do not set an unaffordable/unbounded API budget.

## API contract and data

Server-to-Qloo calls: `GET /search` (`query`, `types`, `take`), and `GET /v2/insights` (`filter.type`, `signal.interests.entities`, `filter.exclude.entities`, `feature.explainability`, `take`). Authentication is `X-Api-Key`, never a URL parameter. The default event origin is `https://hackathon.api.qloo.com`; the standard official origin can be configured if issued credentials require it.

Search accepts an array under `results`, or the documented insights-style `results.entities`; unexpected structures fail visibly. Entity types and IDs must come from upstream matches. Live response compatibility still requires verification with the issued event key. Affinity, when returned, is a relative signal, not a probability of enjoyment. The UI does not transform unexplained API metadata into a made-up reason.

No Qloo response datasets, recorded responses, keys or user preferences are committed. The tests contain clearly invented UUIDs/names. The private database stores only user-confirmed entity ID/name/type; recommendation results are transient. No demographic or precise-location inference is made.

Primary references checked October 12:

- [Qloo event rules](https://qloo.devpost.com/rules)
- [Official event key guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) (current main documentation host did not load during this check)
- [Official Qloo documentation mirror](https://github.com/qloo/docs-public/tree/d4a0eb978518f7fb404993d1509d11b21239ada6), especially `reference/get-search.md`, `reference/api-onboarding.md` and `reference/insights-api-deep-dive.md`.

The mirror's `openapi-schema.json` at that revision is a generic OpenAPI schema definition rather than concrete endpoint response contracts; it was not used to invent missing details.

## Disclosure and remaining gates

Original project: TheOne, existing before this contest. New work: standalone taste workflow, Qloo client, constrained model planner, preference confirmation, topic/browser isolation, SQLite and browser UI. Codex assisted code, tests and documentation under the author's direction. MIT license remains at repository root.

Remaining: received key; actual API response validation; real model/Qloo/browser evidence; free public deployment; accurate public demo; sponsor qualification and actual final-rule approval; one final entry and its receipt. Registration alone is not submission, award or shortlist.
