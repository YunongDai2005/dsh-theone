# InterleaveBench

A benchmark for **routing an interleaved chat**: one person uses a single chat for several pieces of
work at once, and each message has to reach the right one. It measures how often a router gets it
right, how often it sends work into another thread's context (the pollution TheOne exists to avoid),
and what routing costs.

This is phase 1: the data generator, TheOne's router replayed on the data, baselines that need no
model, and the scorer. Pollution probes, assistant replies and the Kaggle notebooks come next.

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

node eval/generate.mjs --sessions 50                     # ≈ $1–2, a few minutes
node eval/run-router.mjs --mode closed --policy llm      # TheOne's prompt, topic list known up front
node eval/run-router.mjs --mode open --policy theone     # topics created on the way, with TheOne's fast path and rules
python eval/baselines.py eval/data/interleave-v0/sessions.jsonl
python eval/score.py eval/data/interleave-v0/sessions.jsonl eval/data/interleave-v0/predictions/*.jsonl
```

Try everything first with `--dry-run`: a fake model stands in, nothing is spent, and the output goes
to `eval/data/interleave-v0-dry`. Every model answer is cached in `eval/.cache`, so a rerun or a crash
halfway costs nothing twice. `--model deepseek-v4-pro` switches model; `EVAL_PRICES="in,cached,out"`
sets USD per million tokens for the cost line (default: V4.1 Flash peak prices, October 2026).

`run-router.mjs` imports TheOne's own routing prompt, payload builder and decision validation from
`dist/`, so its numbers are TheOne's, not a re-implementation's. Phase 1 approximations: there are no
assistant replies yet, so routing sees only the user's side; and in open mode a topic is described by
the messages routed to it, where TheOne would also have the topic session's own progress notes.

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

## Tests

```sh
node --test eval/test/*.test.mjs
python -m unittest discover -s eval/test
```
