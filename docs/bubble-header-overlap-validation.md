# Bubble / main-card boundary repair

Baseline: `6044bbf` on `topic-bubbles` (the handoff/error repair based on `cfb7740`).

## Reproduction

In an isolated DSH Web instance, the current Qwen topic's membrane reached y=193.073 while the TheOne main-card button ended at y=194.073. The membrane therefore overlapped the button by about 1 CSS px. `elementFromPoint` at the button's bottom edge returned the bubble membrane instead of the button.

The current-topic upward force was stronger than the soft top boundary, which only protected 0.56 of the radius. The host intentionally allowed upper overflow for animated messages and drag gestures. Invisible hit circles could also retain a floor larger than the space above their centre.

## Repair

- The soft top boundary now accounts for the full displayed radius and the card gap.
- The final smoothed outline is translated below the card, including its Bezier control hull and a 1px stroke allowance. Labels, centres and hit geometry move with it; the shape is not flattened or clipped.
- A separate 8px header exclusion caps invisible hit circles and duplicate pores, including their minimum-radius floors.
- Budding, leaving and hidden bubbles do not intercept clicks. Intentional drags and throws can still cross the card; message/answer trails remain available.

## Verification

- Regression first failed on the previous curve algorithm and hit-area calculation; it passes after the repair.
- `node --import tsx --test --test-isolation=none tests/client-foam.test.ts`: **31/31 passed**.
- The same tests resolving source imports to built `dist` modules: **31/31 passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed; the built client was used for the visual checks.
- Initial `npm test`: 761 passed, one cancelled after its 30s timeout (`routing-policy.test.ts`, native-gateway clarification case). No assertion failures. That file passed **6/6** when run alone; the slow case took 20.27s.
- Full-suite rerun with `--test-concurrency=4`: **761 passed, the same one cancelled by its 30s timeout**, no assertion failures. The timed-out case took 44.87s; the suite took 380.23s. This run is not counted as an all-green suite.
- Baseline `6044bbf`, the same slow case run alone: **1/1 passed**, 17.74s for the case. Together with the repaired version's isolated pass, this is consistent with load-sensitive test timing; the full-suite timeout remains a validation limitation. No backend code or test timeout was changed for this UI repair.

The real DSH Web client, using an isolated profile and a local fixture model, was checked in eight scenarios: expanded animation, pointer near the current bubble, collapsed rail, sidebar expansion, return after dropping on TheOne, message/routing animation, new-topic animation, and the settled new topic. Across **160 DOM samples**, the minimum visible membrane clearance (including stroke) was **8.2 CSS px**; the minimum invisible-hit clearance was **8.35 CSS px**. No sampled point along the main button's bottom edge hit a bubble. Dragging a different bubble onto TheOne successfully changed the current topic.

Local evidence in the repair checkout's ignored `.theone/` directory:

- `ui-boundary-fixed.png`: screenshot of the repaired card and cluster.
- `ui-boundary-measurements.json`: per-scenario measurement summaries.

This verifies the reported overlap and related interactions in DSH Web. It is not a claim that every desktop UI state is bug-free. No real model key or user profile was needed for these UI checks.
