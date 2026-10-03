# TheOne: session routing for DSH

English | [简体中文](./README.zh.md)

> Unofficial community project, maintained independently. It is not affiliated with or endorsed by DeepSeek.

<p align="center"><img src="docs/images/theone-film-preview.webp" alt="TheOne promo film: the One button turns into a 3D key that routes each message to its session" width="100%"></p>

*From the TheOne promo film (night version).*

Use a single main chat in DSH. TheOne works out which piece of work each message belongs to, hands it to that work's own background session (a Worker), and shows the Worker's progress back in main chat as it happens. It reads like one ordinary conversation, while every topic keeps its own context and related topics can still draw on each other.

![TheOne main chat and topic workspaces](https://raw.githubusercontent.com/YunongDai2005/dsh-theone/main/docs/images/theone-topic-workspaces-en.png)

*The screenshot uses a separate DSH profile and fictional topics.*

Works with DSH `0.2.0-rc.2` and Node.js 24. The interface is in English and Simplified Chinese and follows DSH's language.

## Install

1. Configure an API in DSH and select a model that can chat.
2. Open **Plugins → Add plugin**, paste `https://github.com/YunongDai2005/dsh-theone`, and install.
3. Click **TheOne · Main chat** in the sidebar and start chatting.

No separate API key is needed: routing and Workers use DSH's own models and credentials. From the command line: `dsh plugin --profile web add github:YunongDai2005/dsh-theone --ignore-scripts`. DSH does not update plugins automatically yet, so upgrade by uninstalling and reinstalling. Data lives in `$DSH_HOME/theone/contexts.db` (`~/.dsh/theone/` by default); keep it to continue your topics.

## Like an ordinary session

- Every Worker step appears in main chat as it streams: thinking in its usual place from the first token, then the reply, and tool calls as DSH's own cards with their results. Tools run once, in the Worker.
- Tools that need approval ask on their card; questions the Worker asks you are answered in main chat; todo lists show there too.
- When the Worker retries, main chat redoes the attempt like a native session. Steering typed during a reply reaches the Worker at its next step.
- Main chat's controls apply to the Worker: images (when the backing model accepts them), thinking effort, and permission mode. Picking another model in main chat's model selector changes the Workers' model.
- A bare "ok" or "go on" continues the current topic without waiting for a routing decision.

## How topics are chosen

Each new message is matched to the current topic, an earlier topic, or a new one.

- By default the model you selected in DSH makes one short classification (thinking off, at most 2,048 tokens, 30-second timeout), with candidates recalled from the catalog through DSH full-text search. With no credible match it starts a new topic rather than asking whether it is new.
- When one message draws on several topics ("put the Qwen benchmark into the paper"), the topic doing the work gets it and the others come along as reference, instead of a question back.
- It only asks when you refer to an earlier chat it cannot find, or it truly cannot tell which one you mean. A failed decision never switches topics or starts a Worker.
- Rule-based routing (`THEONE_ROUTER_MODE=rules`) makes no model calls.

## Topic linking

Related topics share progress automatically, within a scope you choose:

| Linking scope | Behavior |
| --- | --- |
| Learn automatically (default) | Starts from the same topic workspace, the same project folder and shared subjects, then learns from use: switching back and forth, mentioning topics together, and a Worker looking another topic up all strengthen a link; unused links fade. |
| Same workspace only | Only topics in the same automatic topic workspace share. |
| Off | Topics share nothing. |

A Worker starting work receives a reference briefing, and none when there is nothing new:

- right after a topic switch, the last few turns of main chat, so "use what we just said" carries over;
- what changed in related topics since it last heard: their latest compaction summary (dated) and the progress recorded after it;
- each topic's constraints (for example "budget figures are for purchasing only"), verbatim and re-attached every time, so compaction cannot drop them.

The briefing is marked as reference, not instructions. For details a Worker can read a related topic with `theone_read_topic` or search its history with `theone_search_history`.

The topic directory shows what each topic is linked to and why. You can link topics, unlink them (they will not link automatically again), mark a topic **Do not share**, or clear learned links. Your own choices always take precedence.

## Topic directory

In the background TheOne reads your existing DSH sessions, builds a topic catalog, and groups related topics into **topic workspaces** (open them from the sidebar). It reuses DSH's compaction summaries where available and skips sessions that have not changed. With a long history, the first pass takes some time and API quota. Set `THEONE_HISTORY_CATALOG=false` to turn it off.

## Settings

Right-click the TheOne button in the sidebar and choose **Settings**. Changes apply after DSH restarts.

| Setting | What it does |
| --- | --- |
| Topic notices | How main chat shows topic changes: hidden, one line only when the topic changes (default), or on every message |
| Linking scope | Learn automatically (default), same workspace only, or off |
| Model | Follow DSH (default) or pin the Workers' model; a pinned model takes precedence over main chat's selector |
| Routing | LLM decision (default) or rule-based |
| History catalog | On/off and rescan interval |
| Limits | Topic descriptor length; reply length per Worker step, thinking included |

Optional environment variables: `THEONE_DATABASE_PATH`, `THEONE_CONTEXTS_PATH` (a hand-written catalog JSON), `THEONE_GATEWAY_KEY`, and `THEONE_WORKER_PROVIDER` / `THEONE_WORKER_MODEL` (set both). Only the legacy direct router (`THEONE_ROUTER_TRANSPORT=legacy`) reads `THEONE_ROUTER_API_KEY`.

## Data and privacy

- DSH keeps the original conversations and tool results; TheOne keeps only its catalog, summaries, links and routing records in its own SQLite database.
- Text sent to the router or written into briefings has API keys, passwords and similar secrets removed.
- A topic marked **Do not share** never appears in other topics' briefings, recent-chat excerpts or lookups.
- When main chat grows long, DSH compacts it through TheOne: frequently used topics keep longer summaries and their latest turns, rarely used ones keep a short status. This makes no model call.

## Known limitations

- One request runs at a time; messages queued during a reply wait for it to finish.
- New topics write files under `~/.dsh/theone/gateway`; you cannot yet choose a project folder for a new topic.
- Main chat stores copies of tool calls, so its log grows with use; entry-log rotation is not implemented yet.
- The main chat is remembered per browser: another browser or the desktop app gets its own main chat, sharing the same topics. Only one DSH process should use a database at a time.
- Image output is not forwarded yet; there is no vector search.
- Main chat shows tool cards without running them because TheOne sits first in DSH's tool pipeline. If another plugin also places itself first, it may see these mirrored calls, but no tool runs twice.

## Development

```sh
git clone https://github.com/YunongDai2005/dsh-theone.git
cd dsh-theone
npm ci --ignore-scripts
npm run typecheck
npm test
```

Tests use the real DSH runtime (AgentLoop, Session, SQLite, JSONL persistence, compaction) with a simulated model, and call no external API. `npm run pack:plugin` builds the install package; `npm run install:local` and `npm run start:local` run a separate DSH profile in `~/.dsh-theone`.

Service API: `ctx.theone.searchHistoryDetailed(contextId, query, limit)` searches a topic's reviewed history; attach an existing session by hand with `store.addSource(contextId, sessionId, { startSeq, endSeq })`. Earlier acceptance records: [v0.1](./docs/plugin-v0.1.md) and [v0.2](./docs/plugin-v0.2.md).
