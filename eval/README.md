# InterleaveBench

A benchmark for **routing an interleaved chat**: one person uses a single chat for several pieces of
work at once, and each message has to reach the right one. It measures how often a router gets it
right, how often it sends work into another thread's context (the pollution TheOne exists to avoid),
and what routing costs.

Phase 1 (`interleave-v0`) measures routing: the data generator, TheOne's router replayed on the data,
baselines that need no model, and the scorer. Phase 2 (`interleave-v1`, [below](#phase-2-shared-facts))
adds the assistant's replies and measures whether one topic gets another topic's facts right.

## Routing events (step 5)

The bundled `eval/data/interleave-v1/` is a **routing event** dataset: 256 deterministic
Chinese/English sessions, 448 user messages, 24-topic catalogs, and 48 owner-only pairs.
It is identified by `routing_schema: "routing-v1"`. The older fact-lifecycle generator also uses
`version: "interleave-v1"`; that version string alone does not select the event protocol.
Generate fact-lifecycle data into a separate directory (commands below). The fact generator
now refuses to overwrite the bundled routing dataset.

`generate-routing-v1.mjs --templates --out <new-directory>` generates the step 7 revision without
a model. Its `--dry-run` uses the fake model to test the natural-language rendering path; omitting
that flag uses the configured model. Paired short text and metadata stay fixed. Generated prose
still needs semantic review before using it as a benchmark.

```powershell
node eval/generate-routing-v1.mjs --templates --out eval/data/routing-copy-dry
node eval/generate-routing-v1.mjs --dry-run --variants 2 --out eval/data/routing-natural-dry
node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split all --mode open --cards --dry-run --out eval/data/interleave-v1/predictions/events-full-dry.jsonl
node eval/run-router.mjs --data eval/data/interleave-v1/sessions.jsonl --split all --mode open --cards --dry-run --state-ablation drop-bindings --out eval/data/interleave-v1/predictions/events-ablated-dry.jsonl
py -X utf8 -B eval/score.py eval/data/interleave-v1/sessions.jsonl eval/data/interleave-v1/predictions/events-full-dry.jsonl --split all --ablation eval/data/interleave-v1/predictions/events-ablated-dry.jsonl
```

Use fresh output filenames/directories; the new protocol refuses overwrites. Explicit catalogs
are seeded even in open mode; seeded IDs are fixed during scoring, while newly created IDs can
be matched to previously absent gold topics. `legacy-v0` cannot replay event datasets.

The driver calls the real correction HTTP handler, closes/recreates the whole plugin runtime on
restart with the same database, and sends explicit references through the product's
`submitMessage` entry (also used by authenticated `POST /api/theone/messages`).
Foreground/pending/background events simulate trusted host observations; their ownership is
registered in the product binding registry, never inferred from gold or installed by changing
currentId. Reliable reply, pending-response and live steering bindings have a real zero-call
receipt. Conflicting, expired and background-only references fall back to normal classification.
`--state-ablation drop-bindings` removes those references and their supporting events; background
observations, text, catalog, corrections and restarts remain. Dataset timestamps are retained,
but do not advance the product clock. State snapshots distinguish visible card,
keyword and fact content from retained exclusion/audit records. Missing snapshots or content
never learned are not scored as clean retractions. See the [Chinese step 5 report](../docs/design/routing-rethink-step5-report.zh.md)
for the schema and coverage, and the [Chinese step 6 report](../docs/design/routing-rethink-step6-report.zh.md)
for the binding protocol, native-host boundaries, current validation, and author-run commands.

## Unmarked routing (step 7)

The primary ablation is `--state-ablation drop-user-refs`: it removes the user's `reply_to`
and `pending_response` selectors while keeping TheOne's foreground provenance, live pending
owners, background observations, and native `steering_of` identity and arrival timing.
`drop-bindings` remains the older destructive control: it also removes foreground/pending
observations and native steering. Neither ablation removes ordinary replies produced by the replay.

Use `eval/data/interleave-v1-step7/sessions.jsonl` for the primary comparison. This separate,
versioned revision has 320 sessions / 512 messages: unique question/approval owner pairs;
separate competing-wait pairs labelled `gold.requires_user_ref`; and a distinct SHARD code in
the final large-catalog request. Original data and step6b predictions are unchanged. A conflict
that requires a removed selector is excluded from unmarked strict accuracy, but remains visible
in per-scenario counts and raw pair diagnostics. Compare pair ablations only on the common
identifiable pairs (`pairs.ablation.comparable_pairs`); `pairs.identifiable` reports the eligible
subset for a single run. Corrections' deliberately ambiguous first messages remain recovery probes.

```powershell
foreach ($ablation in @('none', 'drop-user-refs', 'drop-bindings')) {
  node eval/run-router.mjs --data eval/data/interleave-v1-step7/sessions.jsonl --split all --mode open --cards --dry-run --state-ablation $ablation --out "eval/data/interleave-v1-step7/predictions/example-step7-$ablation.jsonl"
}
py -X utf8 -B eval/score.py eval/data/interleave-v1-step7/sessions.jsonl eval/data/interleave-v1-step7/predictions/example-step7-none.jsonl --split all --ablation eval/data/interleave-v1-step7/predictions/example-step7-drop-user-refs.jsonl
```

The routing-v1 scorer treats a new label for an already seeded topic as `spurious_new`,
reports isolated one-offs separately from thread accuracy, and excludes ambiguous catalog
queries from R@16 (also reporting their count). v0 scoring is unchanged. Dry runs exercise the
pipeline only: their model ignores most semantics and their tokens/prices are synthetic.
See the [step 7 report](../docs/design/routing-rethink-step7-report.zh.md) for the row audit,
validation evidence, bounded product rules, and real-model commands for the author.

## How the data is made

1. **Threads.** A model invents a persona and 3–5 work threads in different domains (code, travel,
   paperwork, …), each with three concrete facts, some of which change later. Half the sessions get a
   *twin*: two threads in the same domain, hard to tell apart.
2. **Plan.** A seeded schedule decides, for every message, which thread it belongs to, whether it
   continues, switches, returns after a long gap, starts a thread or is a one-off question, and how it
   is phrased: *explicit*, through one *cue* detail, with a vague *pronoun*, or *implicit* ("ok next").
   **The plan is the ground truth**, so no message is labelled after the fact.
3. **Messages.** A model writes the user's messages from the plan, eight at a time. Messages meant to
   be vague that still name their subject are rewritten once, and tagged `leak` if they still do.
4. **Independent reading.** A second pass labels each message without the plan. Where it disagrees
   with the plan the message is marked `ambiguous`; strict scores leave those out.

Each line of `sessions.jsonl` is one session:

```json
{"session_id": "zh-0001", "split": "dev", "lang": "zh", "persona": "…",
 "threads": [{"id": "t1", "title": "…", "domain": "…", "goal": "…", "description": "…",
              "facts": [{"key": "…", "value": "…", "update": "…"}], "constraints": ["…"]}],
 "turns": [{"i": 0, "text": "…", "gold": {"thread": "t1", "action": "new", "refs": []},
            "style": "explicit", "tags": ["explicit"], "judge": {"thread": "t1"}, "ambiguous": false}]}
```

`gold.thread` is `null` for a one-off. Every fifth session is in the `test` split; tune on `dev` only.

## Run it

Needs the repository dependencies, a supported DSH Node.js runtime, and Python 3.10+. Build `dist/` with `npm.cmd run build` before a product replay.

```powershell
# Windows PowerShell; on macOS/Linux use: export DEEPSEEK_API_KEY=sk-...
$env:DEEPSEEK_API_KEY = "sk-..."

node eval/generate.mjs --sessions 50 --dataset v0        # ≈ $1–2, a few minutes
node eval/run-router.mjs --replay product-v1 --mode closed --policy theone # actual product, seeded catalog
node eval/run-router.mjs --replay product-v1 --mode open --policy theone   # actual product, empty catalog
python eval/baselines.py eval/data/interleave-v0/sessions.jsonl
python eval/score.py eval/data/interleave-v0/sessions.jsonl eval/data/interleave-v0/predictions/*.jsonl
```

Any OpenAI-compatible provider works as well (an aggregator, a proxy, a local server): give its
address, key and model name instead of `DEEPSEEK_API_KEY`, and pass the same `--model` to every
command so the runs are labelled by it:

```sh
export OPENAI_BASE_URL=https://provider.example/v1     # the address the provider documents, usually ending in /v1
export OPENAI_API_KEY=sk-...
node eval/generate.mjs --sessions 50 --model their-model-name --out eval/data/interleave-facts-v1
node eval/run-router.mjs --replay product-v1 --mode closed --policy theone --model their-model-name
```

`EVAL_EXTRA_BODY='{"…": …}'` adds provider-specific fields to every request, for example to turn off
a model's thinking.

`EVAL_RPM=28` spaces requests evenly for a provider that allows only so many calls a minute; raise
`EVAL_CONCURRENCY` (default 4) along with it so the calls' own latency does not become the limit.

Use `--dry-run` for a fake transport without API credentials or model charges. The generator
writes to `interleave-v0-dry` / `interleave-v1-dry`; the router reads `--data` and writes `--out`
(or a protocol-prefixed file under that dataset's `predictions/`). Supply both explicitly for a smoke run.
Responses use separate `eval/.cache/product-v1` and `eval/.cache/legacy-v0` directories. A local cache
hit makes zero transport calls; set `EVAL_REFRESH=1` when measuring live tokens and latency.
`EVAL_PRICES="in,cached,out"` sets USD per million tokens; verify prices for the chosen model yourself.

`product-v1` is the default. It starts an isolated real DSH/TheOne runtime from `dist/`, using the
product's gateway, `HistoryCatalog.candidates`, second look, catalog review pages, fallbacks,
`settleUnclear`, topic store and correction learning. There is no copied classifier. Each row includes
`trace` (candidates, initial decision, recheck reason, review pages, automatic settlement, final route),
`call_details` (logical calls), and `usage_by_call` (physical transport attempts with layer, input/cache-hit/output
tokens and duration). Card calls (`--cards`) and correction-learning calls have separate `card_usage`
and `auxiliary_usage`; the scorer includes them in total cost without changing routing latency.

This is a controlled routing replay, not an end-to-end Worker benchmark. Each message arrives after
the prior turn and correction learning finish. No host profile is loaded; the catalog is the supplied
snapshot and background scanning is stopped. Worker tools are not executed. `turn.reply`, when present,
provides observed assistant text; v0 has none, so replies are empty. Cards default off for the user-only
v0 replay; add `--cards` when comparing that product configuration. Results must retain these conditions.

The earlier partial simulation is available with `--replay legacy-v0`, including `--policy llm`, burst
ablations and optional `--recheck`. Old predictions without a `replay` field are labelled `legacy-v0`.
The scorer displays the protocols separately and rejects mixing them inside one prediction file.
Missing, duplicate or unexpected prediction keys are errors, including an entirely missing session.

### Bursts: wait, then route what was sent together

These experiments use the separate `legacy-v0` protocol.

People often send several short messages before any reply ("3 of us", "one is elderly", "budget
8000"). Routed one by one, each lacks context; routed together, they are one clear request.
`--merge all` waits a short window after every message and routes everything that arrived in it as
one request; `--merge adaptive` waits only after a message that seems to go on (open punctuation, a
dangling "but/然后", or too short to route alone). The data has no send times, so arrivals are
simulated: `--same` is the chance a message follows the previous one within the window when both
belong to the same thread, `--cross` when they do not (bursts that change subject, which merging gets
wrong). Run a few settings to see how much the answer depends on them:

```sh
node eval/run-router.mjs --replay legacy-v0 --mode open --policy theone                                  # baseline, from cache
node eval/run-router.mjs --replay legacy-v0 --mode open --policy theone --merge all --same 0.35 --cross 0.05
node eval/run-router.mjs --replay legacy-v0 --mode open --policy theone --merge all --same 0.35 --cross 0.15
node eval/run-router.mjs --replay legacy-v0 --mode open --policy theone --merge adaptive --same 0.35 --cross 0.05
node eval/run-router.mjs --replay legacy-v0 --mode open --policy theone --merge all --decide each --same 0.35 --cross 0.05
node eval/run-router.mjs --replay legacy-v0 --mode open --policy theone --merge all --decide each --same 0.35 --cross 0.15
python eval/score.py eval/data/interleave-v0/sessions.jsonl eval/data/interleave-v0/predictions/legacy-v0-open-theone*.jsonl
```

Merging with one decision per burst helps bursts that stay on one thread and hurts bursts that
change subject. `--decide each` keeps the single call but asks for a decision per message: later
messages can lean on earlier ones for context, yet each can go to its own topic (a topic created
earlier in the burst is referred to as `new:<index>`). An answer that does not fit TheOne's checks
falls back to routing the burst's messages one by one, shown as `via: fallback-…`.

The scorer adds a table: accuracy of messages routed alone, in a burst, and in a burst that spanned
threads; the share of replies held for the window (the latency cost); and model calls per message.

## What the scores mean

| Metric | Meaning |
| --- | --- |
| `accuracy` | Share of thread messages that reached their thread (open mode: after matching the system's topics one-to-one to threads). Ambiguous messages excluded. |
| `accuracy_lenient` | Also counts an ambiguous message as right when it went where the independent reading put it. |
| `weighted_error` | Mistakes weighted by what they cost the user: into another thread's topic (3), a new thread merged into an old topic (3), a needless new topic (1), a clarifying question (1). |
| `oneoff_into_topic` | Share of one-off questions that landed in some thread's topic, adding noise there. |
| `topics_per_thread` / `threads_per_topic` | How much threads were split up, and how much topics mixed threads. 1.0 is ideal. |
| `switch` | Precision/recall of noticing that the thread changed. |
| `bcubed` | Clustering agreement between topics and threads. |
| `refs_recall` | Share of messages drawing on another thread where the router named it as related. |
| `tokens_per_message`, `latency_ms` | What routing costs. |

## Phase 2: shared facts

The question: when topic B needs a value settled in topic A (a budget, a date, who owns what), does
it get the value as it stands now, and never one that was only suggested? This is the release gate
for TheOne's shared facts (`docs/design/linker-step1.zh.md`), which stay off by default until it passes.

**Data (`interleave-v1`).** The same plans as v0, with the assistant's reply to every message, and
each fact given a life of its own: the user states it and maybe changes it later; or the assistant
proposes a value and the user accepts it (without repeating it) or turns it down for another; or the
user states it and later withdraws it. A model checks that each exchange does its step, by meaning
rather than wording (word lists, or the plugin's own matching, would keep only the phrasings they
recognise and flatter the result); an exchange that misses its step is rewritten once, and a fact whose step is still missing
is tagged `fact-miss` and left out of the probes. Each session carries `timeline` (what was settled
when: the ground truth) and up to eight `probes`: a question asked inside topic B, right after a given
turn, about one fact of topic A. Probe categories:

| Category | Asked | Right answer |
| --- | --- | --- |
| `cross` | after the value was settled | the value |
| `stale` | by the same topic again, after the value changed or was withdrawn | the new value, or "undecided" |
| `proposal` | right after the assistant proposed a value nobody accepted yet | the previous value, or "undecided" |
| `rejected` | after the user turned a proposal down and chose another value | the user's value |
| `accepted` | after the user accepted a proposal without repeating it | the proposed value |

**Strategies.** Each probe is answered by the model five times, with different context:

| Strategy | Context |
| --- | --- |
| `single` | the whole chat, every topic in one history (no routing) |
| `own` | topic B's history only (routing without sharing) |
| `summary` | B's history and a model-written summary of A up to that moment |
| `facts` | B's history and what TheOne's shared facts deliver |
| `oracle` | B's history and the true value |

For `facts`, `run-facts.mjs` runs TheOne's code from `dist/`: the extractor after every turn (its
prompt, payload, evidence checks and version guards), the candidates offered to routing, the router's
`imports`, the delivery checks and version notices, and the briefing text a Worker would receive.
Topics follow the gold labels, so routing mistakes do not blur the comparison. Routing is measured on
its own: each probe and a sample of turns is routed with and without the facts offered.

```sh
node eval/generate.mjs --sessions 50 --out eval/data/interleave-facts-v1
node eval/run-facts.mjs --data eval/data/interleave-facts-v1/sessions.jsonl
python eval/score_facts.py eval/data/interleave-facts-v1/facts/deepseek-flash.jsonl
```

The scorer prints accuracy by strategy and probe category, how wrong answers went wrong (an old value,
a proposal, "undecided", something else), the context tokens each strategy used, and the gates:

| Gate | Passes when, for `facts` |
| --- | --- |
| `beats_summary` | more of the same, completely paired probes right than `summary` |
| `stale_answers` | under 5% of `stale` probes answered with the old value |
| `proposals_shared` | proposal/rejection probes and actual imports were measured; no delivered value was only proposed for that fact (values found nowhere in the thread are reported as `unknown`) |
| `routing_unchanged` | under 2% changed, routing accuracy does not fall, and under 1% of routing requests fail |

Each strategy retains its own earlier probe answers and reference notes, including changes, so
repeated probes exercise the same remembered facts as a live Worker. Delivery scoring matches the source
topic and, where the extractor's name matches one, the fact's name; otherwise all of that topic's facts. Missing pairs, duplicate answers or failed extraction/session
requests block release; the scorer exits with status 1 until all gates pass. Dry runs use a fake model
and only validate the pipeline, not the release quality of a real model.

What it does not cover yet: the Worker's own `theone_record` and `theone_lookup` calls (only the
extractor writes facts here, so `facts` is a lower bound); related topics' digests in the briefing;
private topics and workspace scope (every topic may share).

## Messages sent while a reply runs

`eval/data/mid-reply/cases.json` holds 35 hand-written cases (Chinese and English, from
`docs/parallel-topics.md`): a reply is running, and the user sends one more message, as an
interjection or queued. Each case says where it belongs: with the running work, another existing
topic, or a new one. Wording is not a guide: other topics' names appear inside requests about the
running work ("put the 9070 numbers in this table too"), and "by the way" appears before other matters.

```sh
node eval/run-mid-reply.mjs                 # with DEEPSEEK_API_KEY, or OPENAI_* and --model, as above
node eval/run-mid-reply.mjs --dry-run       # the pipeline only; the fake model always stays put
```

It reports how often the destination is right, and the two mistakes apart: **mixed in** (another
matter put into the running reply) and **split off** (a change to the running work sent elsewhere,
so the work carries on without it). The plugin's rule is applied as is: a bare "ok" stays, and so
does anything the classifier keeps, cannot decide, or fails on.

## Tests

```sh
node --test eval/test/*.test.mjs
python -m unittest discover -s eval/test
```
