<h1 align="center">TheOne</h1>

<p align="center"><b>One chat for everything you're working on.</b><br>It knows which project each message belongs to, and keeps every project's context separate.</p>

<p align="center">
  <img alt="DSH 0.2.0-rc.2" src="https://img.shields.io/badge/DSH-0.2.0--rc.2-a75b1e">
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-3c873a">
  <img alt="English / 中文" src="https://img.shields.io/badge/UI-English%20%2F%20中文-4a7fb5">
</p>

<p align="center">English | <a href="./README.zh.md">简体中文</a></p>

<p align="center"><img src="docs/images/theone-film-preview.webp" alt="TheOne promo film: the One button turns into a 3D key that routes each message to its session" width="100%"></p>

---

How many sessions are sitting in your DSH sidebar? Getting back to last week's work means digging through them. Skip creating a new one and everything piles into a single session, where topics bleed into each other and the details vanish at the next compaction.

**TheOne takes care of that.** You just talk in one main chat:

```text
You: FP8 still crashes for Qwen on the 9070 XT
     → Qwen / RX 9070 XT
You: also fill in the ablation table in chapter 3 of the paper
     → Video Attention Thesis
You: and add the Qwen speed numbers from earlier
     → Video Attention Thesis · reference: Qwen / RX 9070 XT
You: wrong topic, that was the GPU one
     → Qwen / RX 9070 XT        (the previous message is redone there, and remembered)
```

<sub>Illustration. By default, a one-line notice appears only when the topic changes.</sub>

Each project gets its own background session that reasons, runs tools and compacts on its own. What you see is always one ordinary conversation.

## Why try it

| | Usual workflow | With TheOne |
| --- | --- | --- |
| Start something new | Create a session, name it | Just say it |
| Go back to earlier work | Dig through the sidebar | Mention it; TheOne finds it |
| One session gets cluttered | Topics interfere; compaction drops details | Every project has its own context |
| Two projects need each other | Copy and paste | The other project's progress comes along |
| Wrong project | Move it by hand | Say "wrong topic" |

- **Feels native.** Thinking streams in its usual place from the first token, and tool cards, approvals, questions, todo lists, retries and mid-reply steering all work as usual.
- **Related work connects; unrelated work stays out.** Related topics share progress automatically and TheOne learns which ones belong together from how you use them. A topic's constraints (say, "budget figures stay out of the paper") are attached verbatim every time, so compaction never drops them.
- **Gets better with use.** Say "wrong topic" or click **Move to…** in the directory, and similar messages go to the right place from then on.
- **Your old sessions become a topic directory.** After install it reads your existing sessions in the background, turns them into topics grouped into workspaces, and you pick up where you left off.
- **Nothing extra to configure.** No separate API key: routing and the background sessions use the model you chose in DSH. To switch, pick **TheOne · &lt;model&gt;** in main chat's model menu; it still routes through TheOne, with that model doing the work.

![TheOne main chat and topic workspaces](https://raw.githubusercontent.com/YunongDai2005/dsh-theone/main/docs/images/theone-topic-workspaces-en.png)

## Install in 30 seconds

1. Configure an API in DSH and select a model that can chat.
2. Open **Plugins → Add plugin**, paste `https://github.com/YunongDai2005/dsh-theone`, and install.
3. Click **TheOne · Main chat** in the sidebar and start talking.

From the command line: `dsh plugin --profile web add github:YunongDai2005/dsh-theone --ignore-scripts`. Works with DSH `0.2.0-rc.2` and Node.js 24; the interface follows DSH's language (English / Simplified Chinese).

> Unofficial community project, maintained independently. It is not affiliated with or endorsed by DeepSeek.

## How it works

**Choosing a topic.** Each message is matched to the current topic, an earlier one, or a new one. By default the model you selected makes one short classification (thinking off, at most 2,048 tokens), with candidates recalled through DSH full-text search.

- With no credible match it starts a new topic instead of asking whether it is new. It only asks when you refer to an earlier chat it cannot find, or it truly cannot tell which one you mean.
- When one message draws on several topics, the one doing the work gets it and the others come along as reference.
- "ok" or "go on" continues the current topic without waiting for a decision, and so does a picture or file sent without words.
- If the classification call fails, rules decide, staying in the current topic when unsure. Rule-based routing (`THEONE_ROUTER_MODE=rules`) makes no model calls at all.

**Linking topics.** A background session starting work receives a reference briefing, and none when there is nothing new:

- right after a topic switch, the last few turns of main chat, so "use what we just said" carries over;
- what changed in related topics since it last heard: their latest compaction summary (dated) and the progress after it;
- each topic's constraints, verbatim, every time.

The briefing is marked as reference, not instructions. For details, the background session can use `theone_read_topic` and `theone_search_history`. Linking scope is **Learn automatically** (default), **Same workspace only** or **Off**. In the directory you can link or unlink topics and mark a topic **Do not share**; your choices always win.

**Topic directory.** Each topic card shows its latest progress and constraints. Under **Manage** you can rename, edit the summary and constraints, move to another workspace, merge, delete, or attach an existing DSH session as searchable history; **+ New topic** starts one by hand. **Recent topic routing** lists where each message went, why, with which model and how long it took. With a long history, the first pass takes some time and API quota; set `THEONE_HISTORY_CATALOG=false` to turn it off.

<details>
<summary><b>Settings</b></summary>

Right-click the TheOne button in the sidebar and choose **Settings**. Changes apply when saved; only the history catalog settings wait for a DSH restart.

| Setting | What it does |
| --- | --- |
| Topic notices | How main chat shows topic changes: hidden, one line only when the topic changes (default), or on every message with the reason |
| Linking scope | Learn automatically (default), same workspace only, or off |
| Model | Follow DSH (default) or pin the background model from any model configured in DSH; a pinned model takes precedence over main chat's selector |
| Routing | LLM decision (default) or rule-based |
| History catalog | On/off and rescan interval |
| Limits | Topic descriptor length; reply length per background step, thinking included |
| Manual catalog file | Optional JSON file of hand-written topics, imported when saved |

The database location and entry identifier switch TheOne to different data, so they are set only through environment variables: `THEONE_DATABASE_PATH` and `THEONE_GATEWAY_KEY`. Also optional: `THEONE_CONTEXTS_PATH` and `THEONE_WORKER_PROVIDER` / `THEONE_WORKER_MODEL` (set both).
</details>

<details>
<summary><b>Data and privacy</b></summary>

- DSH keeps the original conversations and tool results; TheOne keeps only its catalog, summaries, links and routing records in its own SQLite database (`$DSH_HOME/theone/contexts.db`, `~/.dsh/theone/` by default).
- Text sent to the router or written into briefings has API keys, passwords and similar secrets removed.
- A topic marked **Do not share** never appears in other topics' briefings, recent-chat excerpts or lookups.
- When main chat grows long, DSH compacts it through TheOne: frequently used topics keep longer summaries and their latest turns, rarely used ones keep a short status. This makes no model call.
- When a new version is out, an **Update** button appears on the right of the TheOne entry in the sidebar: one click installs it through DSH's plugin manager and reloads TheOne in place, without restarting DSH (a DSH without plugin hot reload applies it at the next restart). Your topics stay in the database.
</details>

<details>
<summary><b>Known limitations</b></summary>

- One request runs at a time; messages queued during a reply wait for it to finish.
- New topics write files under `~/.dsh/theone/gateway`; you cannot yet choose a project folder for a new topic.
- Main chat stores copies of tool calls, so its log grows with use; entry-log rotation is not implemented yet.
- The main chat is remembered per browser: another browser or the desktop app gets its own main chat, sharing the same topics. Only one DSH process should use a database at a time.
- Image output is not forwarded yet; there is no vector search; topics cannot be split yet.
- Main chat shows tool cards without running them because TheOne sits first in DSH's tool pipeline. If another plugin also places itself first, it may see these mirrored calls, but no tool runs twice.
</details>

<details>
<summary><b>Development</b></summary>

```sh
git clone https://github.com/YunongDai2005/dsh-theone.git
cd dsh-theone
npm ci --ignore-scripts
npm run typecheck
npm test
```

Tests use the real DSH runtime (AgentLoop, Session, SQLite, JSONL persistence, compaction) with a simulated model, and call no external API. `npm run pack:plugin` builds the install package; `npm run install:local` and `npm run start:local` run a separate DSH profile in `~/.dsh-theone`.

Service API: `ctx.theone.searchHistoryDetailed(contextId, query, limit)` searches a topic's reviewed history; `store.addSource(contextId, sessionId, { startSeq, endSeq })` attaches part of a session. Earlier acceptance records: [v0.1](./docs/plugin-v0.1.md) and [v0.2](./docs/plugin-v0.2.md).
</details>

---

<p align="center">If TheOne helps, a ⭐ helps others find it. Questions or ideas? <a href="https://github.com/YunongDai2005/dsh-theone/issues">Open an issue</a>.</p>
