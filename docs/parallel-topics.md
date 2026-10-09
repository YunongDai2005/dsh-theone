# Messages sent while a reply is running

Status: in development (after 0.3.26).

## What the user does

Only speaks. While main chat is answering, they type again, either queued (Enter: answered after
the reply, DSH's default) or as an interjection (Ctrl/Cmd+Enter: into the running reply). They do not
say which topic, and they do not wait.

## What TheOne does

Every such message is classified at once by the router, which is told what the running reply is
doing (its topic, the request it answers, the last part already shown). No keyword rules: the
router judges whether the message is about the work in progress.

| The message is | Sent as an interjection | Sent queued |
| --- | --- | --- |
| About the work in progress: an extra condition, a change, a correction, "stop", "faster", a reply to what it just said, a question about its progress | Goes into the running reply, as today | Waits for the reply and is answered next in the same topic (the user chose to wait; the topic is busy) |
| Another matter (an existing topic or a new one) | Not mixed into the running reply: its topic starts working on it now, in the background | Its topic starts working on it now, in the background |
| Undecidable, or the router is unavailable | Goes into the running reply (today's behaviour) | Waits and is routed as usual when its turn comes |

Background work is shown in main chat in the order the messages were sent: when main chat gets to
that message, the topic's answer appears at once if it is finished, or carries on live if not. Main
chat therefore always reads as one conversation, question then answer, and nothing is opened beside
it. A background topic that needs a choice or an approval asks in main chat right away.

At most three topics work at once (the one being shown and two in the background). A message
beyond that, or for a topic already busy, waits and is handled when its turn comes, as today.

## Worked examples

Running: the thesis topic is answering "turn the chapter 3 ablation results into a LaTeX table".

| # | The user sends | How | Decision | Why |
| --- | --- | --- | --- | --- |
| 1 | "add a column for memory use" | interjection | into the running reply | a change to the table being made |
| 2 | "no, use booktabs" | interjection | into the running reply | a correction of it |
| 3 | "faster please" / "ok" | interjection | into the running reply | about the work in progress, however short |
| 4 | "stop, don't touch the files yet" | interjection | into the running reply | stops or redirects it |
| 5 | "put the GPU throughput numbers in this table too" | interjection | into the running reply, GPU topic as reference | the work is still this table; the GPU topic only supplies data |
| 6 | "what's the weather in Kyoto tomorrow" | interjection | Kyoto topic, in the background | another matter; not mixed into the table |
| 7 | "does that ryokan have an onsen?" | queued | Kyoto topic, starts now in the background, shown after the table | another matter, so no need to wait |
| 8 | "then do chapter 4 the same way" | queued | waits, then the thesis topic | same topic, which is busy; the user chose to wait |
| 9 | "write me a Rust invoice parser" | queued | a new topic, starts now in the background | a new matter |
| 10 | "is the 9070 benchmark done?" | interjection | GPU topic, in the background | about another running matter, not this table |
| 11 | "what's the difference from the one before?" | interjection | into the running reply | refers to what it is doing; when unsure, the running reply |
| 12 | Kyoto, then the invoice parser, both queued | queued | both start now; shown table → Kyoto → parser | send order, whatever finishes first |
| 13 | a fourth matter while three topics work | queued | waits, routed when its turn comes | the limit |

Running: the GPU topic is benchmarking Qwen3 on the 9070 XT.

| # | The user sends | How | Decision | Why |
| --- | --- | --- | --- | --- |
| 14 | "when it's done, put the result in my thesis table" | interjection | into the running reply, thesis topic as reference | an instruction to the running work about what to do next |
| 15 | "also book the Kyoto trip" | interjection | Kyoto topic, in the background | another matter |
| 16 | "use FP8 instead" | interjection | into the running reply | changes the running work |

## Edge cases

- The running reply ends while a message is being classified: an interjection is then answered as
  its own turn, routed as usual; a background run already started is shown as normal.
- The user deletes a queued message: its background run is cancelled.
- The user stops the running reply: background runs keep going; their messages are still queued.
- A background run fails: its turn shows the failure, as a failed reply does today.

## How to check

`eval/` gains mid-reply cases (the examples above and more) that run the real router with the
user's model; `e2e/` checks the mechanics with the probe model.
