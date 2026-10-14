# TheOne Connected Memory

One conversation across several synthetic projects, with explicit fact sharing and traceable corrections. FalkorDB supplies every topic, permission edge, current value, source note, revision and affected-topic path. Removing it makes memory requests fail; there is no SQLite or fixture fallback.

Graph Hacks track: **Agent Memory and Coordination**. Core graph code began after October15 00:01 IST (October14 18:31 UTC), in `codex/hackathon-graph-memory`. This standalone example adapts the existing TheOne idea; the parent DSH plugin predates the event and is not claimed as new event work. Codex generated the implementation, tests and documentation. Participant technical review and final submission are still pending; no participant authorship or understanding is asserted on their behalf.

## Run locally

Requires Node24+, npm, Docker and two free loopback ports. Uses no paid FalkorDB service. **Synthetic examples only**: do not import private conversations, personal information or restricted data.

```sh
cd examples/falkor-topic-memory
docker compose up -d
npm ci --ignore-scripts
npm test
npm start
```

Open http://127.0.0.1:3060. Database port6389 and the HTTP server bind only to loopback. The container has a dedicated volume, 2 CPUs and 1GB memory. AOF persists graph data through a normal container restart. After a database outage, restart the web server to establish a fresh connection; it does not queue or replay writes while disconnected. The web server writes a local `.session-secret` with mode0600 so the browser's signed namespace remains valid across process restarts. Removing that file makes existing browser workspaces inaccessible through this prototype. The secret is never sent to the model. Never expose this unauthenticated prototype's database to the internet.

The model is optional for **structured controls**, required for **Plan message**. Configure a compatible HTTPS OpenAI chat-completions provider in the server process, not the browser:

```sh
export LLM_BASE_URL='https://your-compatible-provider/v1'
export LLM_API_KEY='your-own-key'
export LLM_MODEL='nvidia/nemotron-3-super-120b-a12b'
export MODEL_CALL_LIMIT=8
npm start
```

No key is bundled. The call limit is local and resets on server restart; it is not a provider spending cap or publicly hosted judging entitlement. Only synthetic user messages and the current workspace's topic titles go to the model. Fact recall is rendered from graph results, without a second model rewrite. Invalid/truncated plans, unknown IDs and mixed recall/write plans fail closed. A model proposal can be wrong; inspect it before confirming. The model never writes Cypher or grants sharing.

## Try the flow

1. Create **Launch plan**, **Travel logistics** and **Reading list** with the direct controls.
2. Say “For the Launch plan, remember the venue is Studio North.” Inspect and confirm the proposal. The source is the supplied synthetic message.
3. Inspect Launch plan and explicitly share only `venue` with Travel logistics. Other launch facts stay separate; Reading list receives nothing.
4. Say “For the Launch plan, revise the venue to Studio East. This corrects the previous venue booking.” Confirm it. The impact panel lists Launch plan and Travel logistics from actual graph paths. History retains Studio North and its source.
5. Ask “For Travel logistics, what is the current venue?” The routed context reads Studio East with its explicit sharing edge. Revoke sharing in the owner's panel and re-inspect Travel logistics: the value is absent.

Sharing is a live reference to future confirmed revisions, not a copy. Revocation prevents later reads in that topic; it cannot erase values a person already saw. Only the owner may revise/re-share. Workspace separation is server-derived graph names from signed browser cookies; cookies must be protected. This is a local demonstration, not production authentication or a security audit.

## Graph model and queries

```
(Topic)-[:USES {grant: owner | explicit user confirmation}]->(Fact)
(Fact)-[:CURRENT]->(Assertion)-[:SUPPORTED_BY]->(Evidence)
(new Assertion)-[:SUPERSEDES]->(old Assertion)
```

A Fact has an owner topic and stable key. Its current Assertion is a confirmed value with revision and timestamp. Each Assertion keeps the source note in Evidence. A second topic sees a fact only through an explicitly created USES edge; no transitive topic-sharing permission is inferred. Every browser workspace uses its own graph.

All executable Cypher is in [queries.mjs](./queries.mjs), using the [official Node client](https://github.com/FalkorDB/falkordb-ts) and [parameterized FalkorDB queries](https://docs.falkordb.com/commands/graph.query). The `context` query walks USES→CURRENT→SUPPORTED_BY. The `impact` query starts at a changed Fact and finds only connected topics. `history` follows SUPERSEDES (up to50 revisions back). `revise` compares the expected revision and replaces CURRENT in a single write query, preventing stale overwrites. `createFact` uses MERGE with a newly generated ID as its creation guard, rejecting concurrent duplicates.

The planner sees a topic directory and proposes recall/remember/revise. It does not make durable changes. A one-use, five-minute server-held proposal must be confirmed in the same browser workspace; corrections retain the version seen at planning time. Direct controls also require explicit confirmation. Sharing and revocation are separate user actions.

## Verification and limitations

`npm test` runs actual FalkorDB integration tests, including permissions, revision conflicts, parameter injection and workspace boundaries. The HTTP proposal test uses an explicitly mocked planner; it proves no real model behavior. `npm run verify:live` requires genuine provider credentials and performs three bounded synthetic model scenarios against the real graph; it has no fixture fallback. These are development examples, not a benchmark accuracy, competition score, held-out result or evidence of participant understanding.

Current development evidence:13 focused tests passed against the real database; three CLI scenarios and four actual browser model requests used genuine Nemotron. Actual browser sharing, revocation, database outage and AOF/server restart were verified. Sanitized summaries are in `evidence/`. These results are assistant verification, not participant verification.

The prototype has no production login, graph size quotas, multi-user collaboration or robust multi-operation transactions. Topic creation and fact confirmation are separate writes; a failed confirmation can leave an empty topic. Graph queries are time-bounded. Context and topic directories are intended for small synthetic demos. No private user history is imported. A [98-second narrated demonstration](https://github.com/YunongDai2005/dsh-theone/releases/tag/graph-memory-prototype-20261015) shows actual recorded browser states with synthetic inputs and generated narration. It is a sequence of real UI captures, not a continuous screen recording. No hosted service, final Graph Hacks submission or prize is claimed yet.

## Participant review before entry

Follow [WALKTHROUGH.md](./WALKTHROUGH.md), inspect the actual queries, run a synthetic sharing/correction/revocation flow, and explain the graph model and decisions in your own words. The [official rules](https://www.wemakedevs.org/hackathons/falkordb/rules) require participant contribution, verification and technical understanding despite allowing disclosed AI help. Do not submit this generated prototype as though that review has already occurred.

License: the parent project's MIT license applies to this original adaptation; third-party dependencies retain their licenses.
