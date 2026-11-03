# Product metrics

TheOne is in engineering-convergence mode: new features are on hold, and changes are judged by how they move the numbers below. Each metric has an operational definition so two people measuring it get the same result.

## Primary metrics

| # | Metric | Definition | Direction |
| --- | --- | --- | --- |
| 1 | **Routing accuracy** | Of messages whose correct target is an *existing* topic, the fraction routed there (KEEP / MOUNT / SWAP to the right context) | Higher is better |
| 2 | **Misroute rate** | Of messages routed to an *existing* topic, the fraction that landed on the wrong topic. (Distinct from creating a new topic — that is metric 3's territory.) | Lower is better |
| 3 | **Task split rate** | Two error directions, tracked separately: **over-split** = messages of one ongoing task that started a *new* topic instead of continuing; **over-merge** = unrelated messages kept in a topic they do not belong to. Reported as a fraction of all routing decisions | Lower is better |
| 4 | **Memory growth** | Host process RSS delta over a fixed replay workload (baseline run vs. +N messages), plus SQLite catalog size per topic. Measured with background indexing on and off | Flatter is better |
| 5 | **Recovery success rate** | After a kill/restart of DSH mid-run: the fraction of topics whose working session, mounted state, and `lastState` survive intact and whose next message continues correctly | Higher is better |

## How to measure

- **1–3: replay benchmark.** Extend the existing replay harness (the historical AI Box replay, 75/79 with a curated catalog) into a repeatable script: `fixtures/` workload → routing decisions → score against a hand-labeled answer key. Report per-release on the same fixture so numbers are comparable across versions. The benchmark uses mocked models so no API quota is spent.
- **4: growth probe.** A test that replays N messages per topic, samples RSS at fixed intervals, and fails when growth exceeds a recorded budget. Catalog size is asserted per topic row.
- **5: chaos test.** A test that interrupts a run at each checkpoint (routing, worker start, mid-reply, post-reply) and verifies resume behavior: `store.interruptTopicRuns()` already exists as the seam for this.

## Acceptance gates

- A routing change that improves one metric must not silently regress another (e.g. tighter new-topic thresholds reduce over-split but raise misroute rate).
- The replay score and growth budgets are recorded per release in this file's change history, not in commit messages.
- Metrics other than these five do not block a release.

## Current status

- Baseline replay score: 75/79 with a manually curated catalog (see the [v0.1 acceptance report](./plugin-v0.1.md)). This is a single run on one dataset, not a statistically strong baseline.
- Growth probe and chaos test: not yet implemented. Until they exist, metric 4 is reviewed manually per release and metric 5 is covered only by existing session-resume tests.
