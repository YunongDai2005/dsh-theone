# TheOne Topic Taste — Qloo adaptation in progress

**Hosting checkpoint, October 25:** the Cloudflare site is deployed at https://theone-topic-taste.yuriddaaii.workers.dev . Static assets and isolated SQLite storage were verified; provider calls remain disabled, with no Qloo/Nebius secrets uploaded and caps 0/0. Actual free allowance and hosted recommendation verification remain pending. The older local integration and video evidence below do not prove hosted recommendations work.

One chat for different plans, with separate confirmed favorites for each topic. A family weekend's taste should not silently become a solo movie night's taste.

**Status, October 15, 2026:** the event API key has arrived and the real cloud integration gate passes: two exact favorite searches, two nonempty recommendations with separate topic signals, and two genuine Nemotron plans for existing/new topics. The passing gate made four Qloo calls and two model calls; see `evidence/cloud-integration.json`. The real browser also completed search, confirmation and recommendation for two synthetic topics: Arrival informed book picks, while Spirited Away informed the family movie picks. A separate HTTP client saw an empty workspace and could not access either topic. An initial live search revealed that Search uses `types`, while Insights uses `subtype`; the client now validates both explicit category shapes. All thirteen offline tests pass, including that regression. These development scenarios are not held-out accuracy measurements. An [85-second recorded-state walkthrough](https://github.com/YunongDai2005/dsh-theone/releases/tag/qloo-topic-taste-prototype-20261015) is now public. It uses two actual October13 browser captures with generated narration; it is not a continuous screen recording or a fresh live run. Creating the video made zero new Qloo/model requests. The cloud/browser results above are from October13. A hosted judge demo and final Qloo submission remain unverified. Offline tests use invented upstream responses and are not cloud results.

This is a standalone Node.js adaptation of TheOne's one-chat/per-topic design. It does not require DSH and does not claim to run the original DSH routing implementation. The repository base was upgraded on October 30 to TheOne **0.4.5**, release commit `10f196d70d69dd5e44ffe8bbdac64bc70b57f0c7`. This merge does not add the DSH plugin's setup flow, sidebar setting or topic controls to the standalone taste app. The deployed Worker code remains the October 21 checkpoint `675f2b8`; this source/documentation update does not redeploy it or enable providers. The October 13 local evidence and October 15 video predate the base upgrade. The source update passes 16 Node tests and the real local workerd checks with synthetic upstream responses, not new Qloo or model calls. New Qloo-specific work started October 12, during the official September 30–October 30 build period. The existing MIT project and Codex assistance must be disclosed in the entry.

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

The default database is `.data/taste.db`, excluded from Git. `TASTE_DB` can point to private persistent storage. The model defaults to the current Nebius Token Factory origin and Nemotron. A configured alternative must support strict JSON-schema responses. Nemotron reasoning is disabled for these bounded 400-token plans; the provider-specific flag is omitted by default for other model names. A genuine smoke run has verified this configured planning path, not general model quality or the complete application.

Without keys, manual topic creation works and live operations report unavailable. There is no fixture mode in the running app.

## Verify the routing model separately

```sh
node --env-file=.env verify-model.mjs
```

This makes at most three real model requests using synthetic topic titles and inputs. It needs only the model key and fails rather than substituting fixtures. It checks existing-topic recommendations, resolving a favorite in a clearly new topic, and asking about an ambiguous reference. It makes zero Qloo calls. The real development probe used this same ModelRouter path; the generic reproduction script is provided for another legitimately configured endpoint.

During debugging, arbitrary JSON mode produced missing plan fields and some reasoning-enabled requests reached the token limit. A later structured response still confused a performer with a book. The final request supplies the schema both to constrained decoding and in the system prompt, defines category meanings, prioritizes favorite resolution, and rejects truncated or mixed-operation output. The three saved calls then passed. Keep broader live checks before claiming a reliable product; these examples do not establish accuracy or a successful Qloo integration.

## Reproduce the local integration with legitimately issued keys

```sh
node --env-file=.env verify-live.mjs
```

This makes bounded real Qloo search/recommendation requests for two synthetic-use-case topics and real model routing calls. It requires exact title matches, nonempty recommendations, correct per-topic request signals and a new-vs-existing route. It fails if any dependency is missing; it never swaps in fixtures. Standard output contains only validation summaries, not Qloo response dumps or credentials. Save detailed private evidence outside Git if needed.

The script is a cloud integration gate, not a routing accuracy benchmark. Before a contest video, also validate a real browser search/confirmation/recommendation journey, service errors and an alternate browser's isolation. Recheck the current official judging period before entry and ensure the working demo remains accessible throughout it. The finite approved provider allowance does not establish unrestricted judging access.

## Hosting preparation

The Dockerfile runs the reference Node server on port 7860 with no external package install. This Node/Docker hosting option was **not deployed**. The actual Cloudflare deployment is described below; any alternative host requires its own applicable terms and secret-storage scope. Use HTTPS and a trusted proxy that supplies `X-Forwarded-Proto`; expose no database files or provider keys. A host without a persistent disk can reset favorites on cold restarts; disclose that limitation rather than promise durable storage. Do not set an unaffordable/unbounded API budget.

### Free Node hosting candidate

`render.yaml` prepares a **Free** native Node service from this public branch, without Docker Hub, a persistent disk, database service, provider keys or automatic redeploys. If using a Blueprint, choose `examples/qloo-topic-taste/render.yaml` explicitly; the file is not at the repository root. Native Node 24 is pinned and requires no package installation. Configuration is prepared, not an accepted/deployed service.

Render's [free-service documentation](https://render.com/docs/free) says idle services sleep after 15 minutes, wake on a request, and lose local SQLite data on sleep/restart/redeploy. `TASTE_EPHEMERAL=1` discloses this in the actual page. Keep secrets absent until actual provider validation and destination approval; request counters are process-local and reset on restart, so also require provider-level quota/spend controls before enabling public traffic. Do not add a payment method or paid upgrade. Keep an offline reproduction path if the free service is suspended or sleeping.

Hugging Face's current [Spaces overview](https://huggingface.co/docs/hub/spaces-overview) requires a paid plan to create Docker Spaces, so it is not the chosen free candidate. A local Docker build attempted October 12 failed retrieving the official Node image's registry token; no image-build success is claimed. This ordinary hosting image is unrelated to the Docker Sandbox contest.

## API contract and data

Server-to-Qloo calls: `GET /search` (`query`, `types`, `take`), and `GET /v2/insights` (`filter.type`, `signal.interests.entities`, `filter.exclude.entities`, `feature.explainability`, `take`). Authentication is `X-Api-Key`, never a URL parameter. The default event origin is `https://hackathon.api.qloo.com`; the standard official origin can be configured if issued credentials require it.

Search accepts an array under `results`, or the documented insights-style `results.entities`; unexpected structures fail visibly. Search's `types` array and Insights' `subtype` must explicitly match the requested category; names alone never establish a match. Entity types and IDs must come from upstream matches. Both routes have now been checked with the issued event key in the limited development scenarios above. Affinity, when returned, is a relative signal, not a probability of enjoyment. The UI does not transform unexplained API metadata into a made-up reason.

No Qloo response datasets, recorded responses, keys or user preferences are committed. The tests contain clearly invented UUIDs/names. The private database stores only user-confirmed entity ID/name/type; recommendation results are transient. No demographic or precise-location inference is made.

Primary references checked October 12:

- [Qloo event rules](https://qloo.devpost.com/rules)
- [Nebius current API quickstart](https://docs.tokenfactory.nebius.com/quickstart) and [structured-output contract](https://docs.tokenfactory.nebius.com/ai-models-inference/json)
- [Official event key guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) (current main documentation host did not load during this check)
- [Official Qloo documentation mirror](https://github.com/qloo/docs-public/tree/d4a0eb978518f7fb404993d1509d11b21239ada6), especially `reference/get-search.md`, `reference/api-onboarding.md` and `reference/insights-api-deep-dive.md`.

The mirror's `openapi-schema.json` at that revision is a generic OpenAPI schema definition rather than concrete endpoint response contracts; it was not used to invent missing details.

## Disclosure and remaining gates

Original project: TheOne, existing before this contest. New work: standalone taste workflow, Qloo client, constrained model planner, preference confirmation, topic/browser isolation, SQLite and browser UI. Codex assisted code, tests and documentation under the author's direction. MIT license remains at repository root.

Remaining: verified free provider allowance, enabled hosted recommendations and working judge access; sponsor qualification and actual final-rule approval; one final entry and its receipt. The public recorded-state video is supporting material, not proof of a currently hosted application. Storage disclosure must match the deployed host: the Worker uses SQLite Durable Objects, whereas the unused Render plan has ephemeral local storage. Confirm provider-level free allowance before public calls. Registration alone is not submission, award or shortlist.


### Workers deployment (provider calls disabled)

`worker.mjs` and `wrangler.jsonc` prepare a SQLite Durable Object host. Provider caps default to zero and no secrets are included. The port is deployed at https://theone-topic-taste.yuriddaaii.workers.dev with both provider caps zero and no provider keys. Public static assets and isolated topic storage were verified; hosted recommendations are not yet enabled or verified. `npm install` followed by `npm run test:worker` runs a real local workerd instance with intercepted synthetic upstream responses; it verifies ownership, bounded requests, restart persistence, candidate confirmations, global request caps and redirect rejection. It does not call real Qloo or a real model, establish production performance, or prove a public deployment. Public static asset bytes were checked against the source files. `npm test` retains the Node tests.

Keep the single `global-v1` object identity: changing it or deleting storage resets persisted counters. This is a capped demo, not a multi-region scale claim. The existing sole-Worker secret scope and maximum 200 Qloo / 100 model attempts are approved subject to verified free allowance. Neither secret upload nor public provider activation has been performed. Preserve the object identity and counters; do not increase or reset the approved budget.
