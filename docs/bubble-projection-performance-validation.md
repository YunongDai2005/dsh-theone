# Bubble projection performance repair

Baseline: `50d124c` on `topic-bubbles`. This follows the routing-test timeout recorded in [the bubble boundary validation](bubble-header-overlap-validation.md).

## Cause and change

Every `sourceRanges(topicId)` call previously loaded and decoded all topic descriptors to find one worker session ID. A bubble projection reads sources for every topic. Catalog health reads also constructed full catalog snapshots, repeating those source reads. Frequent synchronous publication amplified this into roughly quadratic descriptor decoding and long event-loop stalls.

- Look up the worker session ID by the indexed topic ID, preserving bounded-history, worker and legacy-unscoped source classification.
- Add `HistoryCatalog.statusSnapshot()` for current status without topic/group/source enumeration. Bubble health, consent responses and feedback use it; full snapshots share the same status normalization.
- Preserve the original routing test's **30,000ms timeout** and all routing assertions. Add a generous work budget of fewer than 100,000 decoded descriptors for its three-message scenario, so the original approximately two-million-decoding regression also fails on faster machines.

There is no cross-request cache or publication debounce. Status is read fresh, and the original publication/event behavior is retained.

## Measured comparison

The original named routing test was run sequentially on the baseline and repair checkout, using the same forwarding-only read counters. Both use real DSH session/storage/gateway components and the existing local fixture model, with 70 additional topics and three messages. The observer does not replace query results or model behavior.

| Metric | Baseline | Repair |
| --- | ---: | ---: |
| Named test duration | 8,597.95ms | 2,193.81ms |
| Full context-list reads | 27,238 | 491 |
| Topic descriptors decoded | 2,002,718 | 35,683 |
| Source-range reads | 26,565 | 13,319 |
| Bubble publications | 94 | 94 |
| Synchronous time inside publication | 8,100.31ms | 1,704.36ms |

This run reduced test duration by about 74.5% and descriptor decoding by about 98.2%. These are local measurements, not a promise about remote model latency or all library sizes.

## Verification

- Red phase: all three targeted regressions failed on the baseline behavior: health assembled a catalog snapshot; a source lookup decoded unrelated topics; three gateway messages decoded 1,992,030 descriptors.
- Source regressions (`store`, `bubble-api`, `bubble-projection`, `routing-policy`): **35/35 passed**. The originally slow test took 2.20s with its existing 30s limit.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Default full `npm test`: **764/764 passed**, zero failed/cancelled/skipped, 119.51s. The originally slow routing test passed in **4.26s** during this run, with the unchanged 30s timeout and the new decoding budget.
- Regression checks against built modules (`store`, `bubble-api`, `bubble-projection`, `routing-policy`): **35/35 passed**; the originally slow case took 2.11s.

Ignored local logs and read-counter JSON are in the repair checkout's `.theone/` directory and `.theone-*.log` files. The production patch changes only store lookup and catalog status reads; no timeout or default test concurrency was increased.
