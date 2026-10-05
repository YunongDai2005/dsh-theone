# InterleaveBench

A benchmark for **routing an interleaved chat**: one person uses a single chat for several pieces of
work at once, and each message has to reach the right one. It measures how often a router gets it
right, how often it sends work into another thread's context (the pollution TheOne exists to avoid),
and what routing costs.

Phase 1 (`interleave-v0`) measures routing: the data generator, TheOne's router replayed on the data,
baselines that need no model, and the scorer. Phase 2 (`interleave-v1`, [below](#phase-2-shared-facts))
adds the assistant's replies and measures whether one topic gets another topic's facts right.

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

Needs Node.js 22+ (the one DSH runs on) and Python 3.10+. Nothing to install.

```powershell
# Windows PowerShell; on macOS/Linux use: export DEEPSEEK_API_KEY=sk-...
$env:DEEPSEEK_API_KEY = "sk-..."

node eval/generate.mjs --sessions 50 --dataset v0        # ≈ $1–2, a few minutes
node eval/run-router.mjs --mode closed --policy llm      # TheOne's prompt, topic list known up front
node eval/run-router.mjs --mode open --policy theone     # topics created on the way, with TheOne's fast path and rules
python eval/baselines.py eval/data/interleave-v0/sessions.jsonl
python eval/score.py eval/data/interleave-v0/sessions.jsonl eval/data/interleave-v0/predictions/*.jsonl
```

Any OpenAI-compatible provider works as well (an aggregator, a proxy, a local server): give its
address, key and model name instead of `DEEPSEEK_API_KEY`, and pass the same `--model` to every
command so the runs are labelled by it:

```sh
export OPENAI_BASE_URL=https://provider.example/v1     # the address the provider documents, usually ending in /v1
export OPENAI_API_KEY=sk-...
node eval/generate.mjs --sessions 50 --model their-model-name
node eval/run-router.mjs --mode closed --policy llm --model their-model-name
```

`EVAL_EXTRA_BODY='{"…": …}'` adds provider-specific fields to every request, for example to turn off
a model's thinking.

Try everything first with `--dry-run`: a fake model stands in, nothing is spent, and the output goes
to `eval/data/interleave-v0-dry` (or `-v1-dry`). Every model answer is cached in `eval/.cache`, so a rerun or a crash
halfway costs nothing twice. `--model deepseek-v4-pro` switches model; `EVAL_PRICES="in,cached,out"`
sets USD per million tokens for the cost line (default: V4.1 Flash peak prices, October 2026).

`run-router.mjs` imports TheOne's own routing prompt, payload builder and decision validation from
`dist/`, so its numbers are TheOne's, not a re-implementation's. Phase 1 approximations: there are no
assistant replies yet, so routing sees only the user's side; and in open mode a topic is described by
the messages routed to it, where TheOne would also have the topic session's own progress notes.

### Bursts: wait, then route what was sent together

People often send several short messages before any reply ("3 of us", "one is elderly", "budget
8000"). Routed one by one, each lacks context; routed together, they are one clear request.
`--merge all` waits a short window after every message and routes everything that arrived in it as
one request; `--merge adaptive` waits only after a message that seems to go on (open punctuation, a
dangling "but/然后", or too short to route alone). The data has no send times, so arrivals are
simulated: `--same` is the chance a message follows the previous one within the window when both
belong to the same thread, `--cross` when they do not (bursts that change subject, which merging gets
wrong). Run a few settings to see how much the answer depends on them:

```sh
node eval/run-router.mjs --mode open --policy theone                                  # baseline, from cache
node eval/run-router.mjs --mode open --policy theone --merge all --same 0.35 --cross 0.05
node eval/run-router.mjs --mode open --policy theone --merge all --same 0.35 --cross 0.15
node eval/run-router.mjs --mode open --policy theone --merge adaptive --same 0.35 --cross 0.05
python eval/score.py eval/data/interleave-v0/sessions.jsonl eval/data/interleave-v0/predictions/open-theone*.jsonl
```

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
node eval/generate.mjs --sessions 50                     # v1 data, ≈ $1–2
node eval/run-facts.mjs                                  # dev split, ≈ $3–4
python eval/score_facts.py eval/data/interleave-v1/facts/deepseek-flash.jsonl
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

## Tests

```sh
node --test eval/test/*.test.mjs
python -m unittest discover -s eval/test
```
