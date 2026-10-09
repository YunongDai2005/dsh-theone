# End-to-end checks in a real DSH

The unit tests run TheOne on a reduced DSH (no agent presets, no file or shell tools) with a scripted
model. They cannot see what a topic session can actually do. These checks run a real DSH web host
with TheOne installed and a probe model (`probe-models.mjs`) instead of a real one: it routes by
markers, really calls DSH tools, and logs what every session received to `probe.log`. Each check
compares a topic session with an ordinary DSH session doing the same thing.

Run them before a release that touches how topic sessions are created, resumed or run.

## Setup

1. A DSH install (`npm i @deepseek-ai/dsh`) and a profile with TheOne installed; copy this
   repository's `dist/` over the profile's `node_modules/dsh-theone/dist/` to test unreleased code.
2. In the profile's `cordis.patch.yml`: set TheOne's `databasePath` to a scratch file, keep
   `historyCatalog: true`, `catalogIntervalMs: 10000`, no `workerProvider`; set
   `agent-default-model` to provider `deepseek`; insert `probe-models.mjs` as a plugin.
3. Start DSH once, stop it, then seed workspaces: `python3 seed-workspaces.py <DSH_HOME>/storages/workspace.json <dir> 1`
   (a project `<dir>/work/proj` and DSH's default workspace `<dir>/docs/deepseek-harness/default-workspace`;
   pass `0` to leave the default workspace out).
4. Start DSH with `PROBE_LOG=<dir>/probe.log`, output to `dsh.log` in the directory you run `drive.mjs` from.

`node drive.mjs native <workspace> "<message>" [preset] [access]` sends a message in a new ordinary
session; `node drive.mjs main "<message>" [preset] [access]` sends it in TheOne's main chat. Markers:
`[topic:NAME]` routes to the topic titled NAME (or creates it), `[name:NAME]` names the topic the
history catalog makes of an ordinary session, `[run] CMD` runs CMD with the bash tool, `[ask]` asks a three-option question, `[call:TOOL] {json}` calls any tool, `[project:NAME]` puts a new topic in that project folder; a goal round is read and completed through the goal tools.

## Checks (all passed on 2026-10-09)

`node mid.mjs "<first>" "<interjection>" "<queued>" [seconds]` sends a message in main chat and, while it runs, an interjection (Ctrl+Enter) and a queued message (Enter).

| Check | Expected |
| --- | --- |
| Tools of a new topic, an existing topic, a topic from an existing chat, after a DSH restart | Same as an ordinary session, plus TheOne's three |
| Folder of a new topic | DSH's default workspace; TheOne's own folder when there is none |
| Folder of a new topic about one of the user's projects (`[project:NAME]`) | That project's folder, without asking; the session is not added to the project in DSH's sidebar |
| Folder of a topic made from an existing chat | That chat's folder (reads and writes the project) |
| Access mode "read only" set in main chat | A write is refused in the topic, as in an ordinary session |
| A second browser or device opens main chat | The same main chat, not a new empty one |
| A topic asks a question (`[ask]`; `ask.mjs`, `answer.mjs`) | The choice window opens in main chat; an option, or a typed answer, reaches the topic |
| A topic needs approval (`[call:bash]` with `sandbox_permissions` under read only) | The approval prompt opens in main chat; "allow once" lets the topic continue |
| DSH's sidebar | No "Unassigned" heading when only TheOne's sessions are outside a workspace |
| `/compact` in main chat (`cmd.mjs`) | The topic in use is compacted, and the command says so; main chat's own compaction shows as DSH's notice |
| `/goal` in main chat | Each round runs in the topic the goal was set in; the topic reads and completes main chat's goal, and the goal ends |
| "Branch in a new chat" on a reply in main chat (`branch.mjs`) | A new topic "<title> (branch)" from that point; main chat stays open, keeps its name and says so; the next message goes to the branch |
| Main chat's file panel and a new terminal (`term.mjs`) | Both in the folder of the topic in use |
| A topic edits a file in a git project (`[run] echo x >> readme.txt`; `changes.mjs`) | Main chat's reply carries the same "Edited readme.txt +1 −0" card as an ordinary chat; opening it shows the comparison, numbered by main chat's turn |
| A background topic asks for approval while another reply runs (`ACCESS=仅可查看` with `mid.mjs`) | The approval prompt opens in main chat at once and names the topic; "allow once" lets it continue |
| While a reply runs (`[run] sleep 10`; `mid.mjs`): an interjection for another topic | That topic answers at once in the background; the reply is not mixed with it; main chat shows it after the reply, as its own turn |
| While a reply runs: an interjection about it, and a queued message for another topic | The interjection joins the reply (between its steps); the queued message's topic starts at once and is shown after |
| While a reply runs: a queued message whose topic asks a question (`CLICK=<option>`) | The choice window opens in main chat at once, headed with that topic's name; the answer reaches it |
| DSH's workspaces and archive afterwards | No TheOne session attached to a workspace; the archive holds only TheOne's sessions; none of the user's sessions archived |
