<h1 align="center">TheOne</h1>

<p align="center"><b>Too many DSH sessions to find the old one? Talk in one chat, and it picks up where you left off.</b><br>Each message goes to the thing it's about; each thing keeps its own session and project folder, so you can come back days later and carry on.</p>

<p align="center">
  <img alt="DSH 0.2.0-rc.2 / 0.2.1-rc.2" src="https://img.shields.io/badge/DSH-0.2.0--rc.2%20%7C%200.2.1--rc.2-a75b1e">
  <img alt="Free and open source, MIT" src="https://img.shields.io/badge/free%20%26%20open%20source-MIT-3c873a">
  <img alt="English / 中文" src="https://img.shields.io/badge/UI-English%20%2F%20中文-4a7fb5">
</p>

<p align="center"><a href="http://theone.yulid.org/">Website</a> · English | <a href="./README.md">简体中文</a></p>

<p align="center"><img src="https://raw.githubusercontent.com/YunongDai2005/dsh-theone/main/docs/images/theone-demo-en.webp" alt="Demo: two unrelated requests in the main chat each get their own topic in the sidebar; going back to the first one continues it in its own topic" width="100%"></p>

<p align="center"><sub>A GPU question, a hotel question, then the GPU again, with no cues in between. The two topics on the left made themselves; nothing was clicked. (Example conversation.)</sub></p>

<p align="center"><b>Install:</b> in DSH open <b>Plugins → Add plugin</b>, enter <code>dsh-theone</code> and install. No extra API key.</p>

<p align="center"><b>Questions or problems?</b> Email <a href="mailto:theone@yulid.org">theone@yulid.org</a> or <a href="https://github.com/YunongDai2005/dsh-theone/issues">open an issue</a>. Chinese-speaking users: QQ group 1080980184.</p>

---

How many sessions are sitting in your DSH sidebar? Getting back to last week's work means digging through them. Skip creating a new one and everything piles into a single session, where topics bleed into each other and the details vanish at the next compaction.

If you've ever said any of these, TheOne was probably written for you:

- "Where was that chat again?" Too many conversations, and the old one is nowhere to be found.
- "Not starting a new chat for this, I'll just ask here." And one chat turns into a mess.
- "I already told you that!" The AI forgot what you talked about.

**What TheOne does:** you only ever talk in one main chat. In the background it opens a separate session for each thing you're working on and sends every message to the one it belongs to.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/YunongDai2005/dsh-theone/main/docs/images/theone-architecture-en-dark.svg">
  <img alt="How TheOne works: main chat sends each message through the router to its topic session; answers stream back, and the topic directory keeps progress, constraints and links" src="https://raw.githubusercontent.com/YunongDai2005/dsh-theone/main/docs/images/theone-architecture-en-light.svg" width="100%">
</picture>

Each project reasons, runs tools and compacts in its own session. What you see is always one ordinary conversation.

## Why try it

| | Usual workflow | With TheOne |
| --- | --- | --- |
| Start something new | Create a session, name it | Just say it |
| Go back to earlier work | Dig through the sidebar | Mention it; TheOne finds it |
| One session gets cluttered | Topics interfere; compaction drops details | Every project has its own context |
| Two projects need each other | Copy and paste | The other project's progress comes along |
| Wrong project | Move it by hand | Say "wrong topic" |

- **Feels native.** Thinking streams in its usual place from the first token, and tool cards, approvals, questions, todo lists, retries and mid-reply steering all work as usual.
- **Keep talking while it works.** A message sent during a reply that is about that reply joins it, as in any DSH chat; one about something else starts in its own topic right away, in the background, and its answer follows in main chat in the order you sent things. At most three topics work at once.
- **Works where the work is.** A new topic about one of your projects works in that project's folder; anything else goes to DSH's folder for chats outside any project. Nothing is added to your projects in the sidebar.
- **Related work connects; unrelated work stays out.** Related topics share progress automatically, and which ones belong together is learned from how you use them. A topic's constraints (say, "budget figures stay out of the paper") are attached verbatim every time, so compaction never drops them.
- **Learns your words.** Once a topic has replies, a short topic card is written in the background (what it is, what you call it, the people, places and files involved, and the values it has settled on, such as a budget or an order number), and rewritten as the topic goes on, so it is recognised however you phrase it. New names you use are added without forgetting the old ones, and a settled value keeps when it was recorded and what it replaced. Say "wrong topic" and it remembers which terms tie that kind of message to the right one. A topic you haven't touched for months, or whose conversations you archived, is not ruled out: when the message says what it is about ("the deposit from last year"), that topic is picked; time only decides between topics that fit equally, so "that thing just now" means the recent one. Back after three days or more, the topic opens with "last time we noted…" and treats dates, amounts and progress as the last record, not as today's.
- **Picks up after a restart.** If DSH stopped while a topic was working, the topic's own session tells what happened: finished work is shown as it was given, and work cut off midway lists what it had already changed; say "continue" and the topic checks the current state before carrying on, instead of redoing it. Each topic keeps where it stands as goal / done / next.
- **Checks before acting on the wrong thing.** Before a topic first changes a file, runs a command or sends something for a message, it asks you once in main chat if the message might have belonged to another topic, or if the change points into a different project than the topic works in. A confident route in the right folder goes ahead without asking.
- **"Wrong topic" cleans up after itself.** Under **Recent topic routing**, a message that might have belonged elsewhere offers **Move to …** for the likely topics, and a moved message offers **Undo**. The wrong topic forgets that turn (it stays out of its history, card and facts) and is told once; anything the turn already changed is listed for you, since nothing is undone behind your back.
- **Your old sessions become a topic directory.** After you agree in **Topic workspaces**, it reads your selected existing sessions in the background with the model you chose, turns them into topics and sorts them into topic workspaces (TheOne's own groups, unrelated to the projects in DSH's sidebar), and you pick up where you left off. It only reads: your sessions stay as they are. With many sessions this uses some quota; turn **History catalog** off in the settings if you don't want it.
- **Nothing extra to configure.** No separate API key: it uses the model you chose in DSH. When TheOne is selected, a layers icon beside the model menu shows and switches which model routes and which does the work.

## Install in 30 seconds

1. Configure an API in DSH and select a model that can chat.
2. Open **Plugins → Add plugin**, enter `dsh-theone` under *Package name or address*, and install.
3. Click **TheOne · Main chat** in the sidebar and start talking.

That's it. Works with DSH `0.2.0-rc.2` and `0.2.1-rc.2`, and Node.js 24; the interface follows DSH's language (English / Simplified Chinese).

<details>
<summary><b>New to DSH? A step-by-step walkthrough (about 3 minutes)</b></summary>

No coding needed:

1. **Make sure DSH itself can chat.** Add your model provider's API key (DeepSeek's, for example) in DSH's settings, open an ordinary chat and say "hi". If it answers, you're set. TheOne uses that same model; there is no other key to enter.
2. **Install TheOne.** Click **Plugins** in the sidebar, then **Add plugin**, and enter:

   ```
   dsh-theone
   ```

   Click install and wait for it to finish.
3. **Start.** A new **TheOne · Main chat** appears in the sidebar. Open it and just talk about whatever is on your plate: today's work, the weekend trip, the paper you're writing. No new chats to create, nothing to name.
4. **Updates.** When a new version is out, a download icon appears next to the TheOne entry. One click installs it, usually without a restart; your topics live in the database and are untouched.
5. **Changed your mind?** Uninstall it on the Plugins page. Your DSH chats are all still there; TheOne organises them and never deletes them.

**Small things you may run into**

- **"Too new" and it won't install:** DSH only installs versions published at least 24 hours ago. That's a safety rule, not an error. Wait a day, or enter the GitHub address `https://github.com/YunongDai2005/dsh-theone` instead, which installs right away.
- **No TheOne in the sidebar after installing:** restart DSH.
- **Something wrong?** Click **Report a problem** at the top right of **Topic workspaces**: versions and diagnostics (no chat content) are attached, and Send delivers it without GitHub. Or email [theone@yulid.org](mailto:theone@yulid.org); a screenshot helps.
- **Will it cost a lot?** Each message adds one short classification call (no deep thinking); about one in six (a new topic, a question, or a doubtful pick) gets a second call with thinking. "ok" or "go on" skips even the first. On DeepSeek V4.1 Flash that is about half a US dollar per thousand messages: at 100 messages a day, routing adds about $2 a month. The work itself runs on the model you chose and costs what it always does. With many old chats, the first pass that organises them uses some of your quota; turn **History catalog** off in the settings if you don't need it.
</details>

<details>
<summary><b>Command line and other sources</b></summary>

- npm: `dsh plugin --profile web add dsh-theone --ignore-scripts` (use `desktop` instead of `web` for the desktop app)
- GitHub (always the latest main): `dsh plugin --profile web add github:YunongDai2005/dsh-theone --ignore-scripts`

A new version from npm installs once it has been published for 24 hours; when an update is newer than that, the update button explains it and can exempt TheOne alone so it installs right away.

For a local demo using NVIDIA Nemotron 3 Super through Nebius Token Factory, see [Nebius/Nemotron setup](docs/nebius-demo.md).
</details>

> Unofficial community project, maintained independently. It is not affiliated with or endorsed by DeepSeek.

## From your phone (experimental)

Talk to main chat away from your computer: bind a messaging app in **TheOne Settings**, and what you send from your phone works like typing in main chat. It goes to its topic and runs in the background, and the reply comes back to your phone. Approvals and the AI's questions come too; answer with a number (no answer within 10 minutes declines). Main chat on your computer shows the same conversation. Only you are listened to; nobody else's messages reach main chat.

| App | How to bind | Notes |
| --- | --- | --- |
| WeChat | **Scan to bind** in Settings, then scan with WeChat on your phone | Uses Tencent's iLink interface (the same as the OpenClaw WeChat plugin), a private Tencent protocol; follow WeChat's terms |
| Telegram | Make a bot with @BotFather, paste its token in Settings, then scan the code (or send `/start <code>`) to pair | The token stays on your computer |
| iMessage | Mac only: enter the phone number or Apple ID you text from | Give the app running DSH Full Disk Access, and allow it to control Messages on the first reply |

Messages arrive only while DSH is running, not while the computer sleeps or DSH is closed. After a network drop or a restart it picks up where it left off, without losing or repeating messages.

## How well does it route?

Claims are cheap, so we built a public benchmark, **InterleaveBench**: one person pushing 3–5 things forward in the same chat at once (a trip, a budget, a paper, a training plan…), half in Chinese and half in English, 50 conversations and 2,466 messages, each labelled in advance with the thing it belongs to. Below, the 40-conversation dev split replayed message by message through TheOne's own routing code with DeepSeek V4.1 Flash, thinking off as TheOne routes (messages even a careful human could not attribute are not scored):

| Approach | Messages routed correctly |
| --- | --- |
| TheOne 0.3.38, topic list given up front | **98.7%** |
| TheOne 0.3.38, starting from nothing and creating topics as it goes (your first day) | **96.3%** |
| TheOne 0.3.37 (one quick decision per message), topic list given up front | 92.9% |
| TheOne 0.3.37, starting from nothing | 90.1% |
| Keyword search (BM25), topic list given up front | 73.3% |
| No routing, everything in one chat | 44.5% |
| Keyword search, starting from nothing | 39.9% |
| A new topic for every message | 9.8% |

A few numbers worth knowing:

- These numbers were measured on 0.3.38.
- **On ten conversations kept aside while tuning**, starting from nothing: 97.1% (0.3.37: 90.7%).
- **One thing is split over 1.47 topics** on average (0.3.37: 1.80), and needless questions back to you dropped from 49 to 9.
- **A message landing in another thing's topic**, the mistake that hurts context most: 2.8% when starting from nothing. It is 1.5% with thinking on for every message, so this is what we work on next.
- **Topic cards** are not simulated in the table. With them (as in the plugin), starting from nothing: 96.9%, and 1.9% of messages land in another thing's topic.
- **What it costs:** about one message in six gets the second look; routing costs about $0.5 per thousand messages (one quick decision only: $0.41; thinking on for every message: $0.55), and topic cards add about $0.16.
- Data, code and scoring live in [`eval/`](./eval/README.md); reproduce it, or try another model. The full write-up, with confidence intervals, token use and what did not work, is in [`docs/routing-eval.md`](./docs/routing-eval.md) (Chinese).

The conversations are model-written from a script and this version has no assistant replies, so it measures whether messages are routed right, not everything about how chatting feels.

## Recent changes

Version 0.3.40 makes mistakes **cheap to notice and undo**: a topic about to change a file, run a command or send something checks with you once when it may have the wrong topic or the wrong project; a misrouted message moves to the other likely topic in one click, and the move can be undone; a merge can be undone. Old and archived topics come back when you mention them, and say where things stood last time instead of treating it as today's state (see [How it works](#how-it-works)).

Version 0.3.39 makes the topics **disappear into the background**: main chat no longer shows topic switches (turn on **Topic notices** in the settings to see where each message went) or asks where a message belongs, a topic that gets a message not its own hands it back before doing anything, and a message that mentions a figure, code or name from another topic gets that topic's words along (see [How it works](#how-it-works)).

Version 0.3.38 **routes more accurately**: when the quick decision would open a new topic, ask you, or goes against a number, code or name only one topic has mentioned, it takes a second look with thinking on. On our benchmark that lifts accuracy from 90% to 96% when starting from nothing, and one thing is split over fewer topics (see [How well does it route?](#how-well-does-it-route)). It also picks up cleanly after a DSH restart and after "wrong topic". Ongoing tasks (follow a GitHub PR and CI from main chat, since 0.3.36) are described in [implementation and limitations](./docs/persistent-work.md) (Chinese).

Earlier versions are in [Releases](https://github.com/YunongDai2005/dsh-theone/releases).

## What's next

For now, TheOne is being refined on DeepSeek Harness, whose background sessions, tools and compaction can be reused as they are: the right place to get "one chat for everything" solid first.

In progress:

- **Better routing**: fewer messages landing in another thing's topic, and looking at a burst of messages together while deciding each one separately.
- **Confirmed facts shared between topics**: a budget, a date, where a file lives, kept current wherever you need it. It is experimental and will only be turned on by default once it passes its benchmark.

Once it is stable, the next step goes beyond DSH:

- **A standalone client**: one interface over different models and providers, opening straight into a single chat;
- **or adapters for other platforms**: the same automatic topics, inside the chat tools you already use.

Which comes first depends on what people need more. If you have a view, say so in [Issues](https://github.com/YunongDai2005/dsh-theone/issues) or by email at [theone@yulid.org](mailto:theone@yulid.org).

## How it works

**Choosing a topic.** Each message is matched to the current topic, an earlier one, or a new one. By default the model you selected makes one short classification (thinking off, at most 2,048 tokens), with candidates recalled through DSH full-text search.

- When the quick decision would start a new topic, ask you, or goes against a number, code or name only one topic has mentioned, the same model looks again with thinking on (about one message in six). If that call fails, the first decision stands.
- It never asks you where a message belongs. With no credible match it starts a new topic; when it cannot tell which of a few topics you mean, the closest one does the work and the others come along as reference; an earlier chat it cannot find continues the current topic, which can search your history itself.
- When one message draws on several topics, the one doing the work gets it and the others come along as reference.
- If the topic that gets a message finds it is not its own, it hands it back before doing anything; TheOne routes it again without that topic, and main chat shows the right topic's answer. Once per message.
- "ok" or "go on" continues the current topic without waiting for a decision, and so does a picture or file sent without words.
- If the classification call fails, rules decide, staying in the current topic when unsure. Rule-based routing (`THEONE_ROUTER_MODE=rules`) makes no model calls at all.

**Linking topics.** A background session starting work receives a reference briefing, and none when there is nothing new:

- right after a topic switch, the last few turns of main chat, so "use what we just said" carries over;
- when the message mentions a number, code or name that only another topic has mentioned, what that topic said about it and where it stands, linked or not;
- what changed in related topics since it last heard: their latest compaction summary (dated) and the progress after it. Topics are related when a message draws on both or one looks the other up; switching between them does not count;
- each topic's constraints, verbatim, every time.

The briefing is marked as reference, not instructions. For details, the background session can use `theone_read_topic` and `theone_search_history` (which can also search every topic that shares with it). Linking scope is **Learn automatically** (default), **Same workspace only** or **Off**. In the directory you can link or unlink topics and mark a topic **Do not share**; your choices always win.

**Topic directory.** Each topic shows its latest progress and constraints, the project (DSH workspace) it works in, and its status when that is not plain in progress: **Waiting on you** (it asks you something, or a restart cut its work off), **Set aside** (untouched for longer than you usually come back), or **Done** (you marked it; a new message to it reopens it). Status is kept apart from the topic's record of what it worked on (its latest 20 messages and how each ended), and is worked out from it. **Mark done** / **Reopen** sits next to **Manage**. A new topic files itself in the workspace of a topic it draws on, or of the topics in its project folder; you can move it. Under **Manage** you can rename, edit the summary and constraints, move to another workspace, merge (the target topic then shows **Undo merge**, which brings the merged topic back as it was), delete, or attach an existing DSH session as searchable history; **+ New topic** starts one by hand. **Recent topic routing** lists where each message went, why, with which model and how long it took. With a long history, the first pass takes some time and API quota; set `THEONE_HISTORY_CATALOG=false` to turn it off.

![TheOne main chat and topic workspaces](https://raw.githubusercontent.com/YunongDai2005/dsh-theone/main/docs/images/theone-topic-workspaces-en.png)

<details>
<summary><b>Settings</b></summary>

Right-click the TheOne button in the sidebar and choose **Settings**. Changes apply when saved; only the history catalog settings wait for a DSH restart.

| Setting | What it does |
| --- | --- |
| Topic notices | How main chat shows topic changes: hidden (default; the topic workspace shows where each message went), one line only when the topic changes, or on every message with the reason |
| Linking scope | Learn automatically (default), same workspace only, or off |
| Share confirmed facts (experimental) | Off by default. Topics share only facts the user confirmed (a figure, a decision, where a file is), with version and source; a topic that used one is told when it changes or is withdrawn. Applies after a DSH restart |
| Record facts automatically (experimental) | Off by default. With shared facts on, one small model call after each turn records facts the topic session left out; only user-confirmed ones are shared |
| Model | Follow DSH (default) or pin the background model from any model configured in DSH; a pinned model takes precedence over main chat's selector |
| Routing | LLM decision (default) or rule-based |
| History catalog | On/off and rescan interval |
| Limits | Topic descriptor length; reply length per background step, thinking included |
| Manual catalog file | Optional JSON file of hand-written topics, imported when saved |

The database location and entry identifier switch TheOne to different data, so they are set only through environment variables: `THEONE_DATABASE_PATH` and `THEONE_GATEWAY_KEY`. Also optional: `THEONE_CONTEXTS_PATH` and `THEONE_WORKER_PROVIDER` / `THEONE_WORKER_MODEL` (set both).
</details>

<details>
<summary><b>Data and privacy</b></summary>

- Everything stays on your computer. Routing, topic cards and organising old sessions use the model you chose in DSH; requests go straight to that model provider, never through a TheOne server.
- DSH keeps the original conversations and tool results; TheOne keeps only its catalog, summaries, links and routing records in its own SQLite database (`$DSH_HOME/theone/contexts.db`, `~/.dsh/theone/` by default).
- Text sent to the router or written into briefings has API keys, passwords and similar secrets removed.
- A topic marked **Do not share** never appears in other topics' briefings, recent-chat excerpts or lookups.
- Notices from the author are read from `https://yulid.org/theone/notice.json` with a plain request that sends none of your data; turn them off in Settings.
- **Report a problem** (top right of Topic workspaces, or **Report a problem** on a message under Recent topic routing) sends only when you press Send, and shows everything it would send first. By default it holds versions, settings and routing error codes and timings, no chat content; for one message, its text and reply are added only if you tick the box. Reports go to `feedback.yulid.org`, are used only to look into problems and are deleted after 90 days; to have one deleted sooner, email theone@yulid.org with its id.
- When main chat grows long, DSH compacts it through TheOne: frequently used topics keep longer summaries and their latest turns, rarely used ones keep a short status. This makes no model call.
- Updates are installed by DSH's plugin manager and reload TheOne in place; a DSH without plugin hot reload applies them at the next restart.
</details>

<details>
<summary><b>Known limitations</b></summary>

- Telling whether a message sent during a reply is about that reply needs the routing model; with rules-only routing, every such message joins the reply, as before.
- A new topic not about any of your projects works in DSH's own folder for chats outside any project (`Documents/deepseek-harness/default-workspace`), or in `~/.dsh/theone/gateway` if you do not have that folder. Topics organised from your existing chats work in those chats' folders.
- Main chat stores copies of tool calls, so its log grows with use; entry-log rotation is not implemented yet.
- Only one DSH process should use a database at a time.
- Image output is not forwarded yet; there is no vector search; a topic cannot be split in two yet (a merge can be undone).
- The tool cards in main chat only show the tools the topic is using; nothing runs a second time. This relies on TheOne sitting first in DSH's tool pipeline; if another plugin also places itself first, it may see these display-only copies, but each tool still runs once.
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

<details>
<summary>🥚</summary>

<br>

Congratulations, you found the easter egg.

In the benchmark, TheOne once made a very human mistake. The user said "the café's autumn menu was due on September 25, let's push it to October 8", and TheOne filed it under the October holiday trip to Yunnan. Both were in October, after all.

We're still training it. If it ever files something of yours in the wrong place, just say "wrong topic" in the main chat. It will remember, and it won't take it personally.

</details>

---

<p align="center">If TheOne helps, a ⭐ helps others find it. Questions or ideas? <a href="https://github.com/YunongDai2005/dsh-theone/issues">Open an issue</a> or email <a href="mailto:theone@yulid.org">theone@yulid.org</a>.</p>
