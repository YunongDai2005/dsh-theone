# End-to-end checks in a real DSH

The unit tests run TheOne on a reduced DSH (no agent presets, no file or shell tools) with a scripted
model. They cannot see what a topic session can actually do. These checks run a real DSH web host
with TheOne installed and a probe model (`probe-models.mjs`) instead of a real one: it routes by
markers, really calls DSH tools, and logs what every session received to `probe.log`. Each check
compares a topic session with an ordinary DSH session doing the same thing.

Run them before a release that touches how topic sessions are created, resumed or run.

## Windows custom-permission regression (2026-10-15)

Baseline: npm `dsh-theone@0.3.33` with `@deepseek-ai/dsh@0.2.0-rc.2`, Node 24.21.0,
in an isolated profile. The probe model supplies deterministic calls; PowerShell,
Node child processes, session persistence and permission services are real.

Reproduction: use a standard-preset main chat with `sandbox/mode = danger-full-access`
and `approval/policy = ask`. DSH reports this combination as `custom`. Ask its topic
to run a Node script that calls `execFileSync(process.execPath, ['-e',
"process.stdout.write('CHILD_EXEC_OK')"], { encoding: 'utf8' })`.
The published plugin leaves the topic at `workspace-write`; Windows rejects the child
process with `spawnSync ... EPERM`. The same custom settings in an ordinary DSH session
produce `CHILD_EXEC_OK`. After the fix, the topic also reports `custom` and succeeds.

Controls: named permission modes still match main chat. Under `workspace-write`, the
Node piped-child command remains denied in both ordinary and TheOne sessions; the fix
does not remove DSH's sandbox boundary. Plain PowerShell commands succeed in standard
and minimal presets with workspace-write or full access. Minimal-preset read-only
shell calls timed out in both ordinary and TheOne sessions in this environment, so
that combination is not claimed as passing. File-write probes were run too, but are
not evidence of filesystem confinement.

`tests/permissions.test.ts` uses DSH's actual permission, sandbox-policy and approval
services to cover new/reused topics, approval changes, permission reductions, returning
to named presets, and avoiding duplicate override events. It fails against the baseline
on `workspace-write/ask` versus the expected `danger-full-access/ask`.

In a separate clean Web profile, sending a PowerShell probe from the browser showed
`MAIN_CHAT_VISIBLE_OK` in main chat. A subsequent explicit escalation displayed the
approval prompt on that main-chat tool card; rejecting it returned the rejection to
the topic. The native sidebar omitted the topic session as designed, while the
conversation itself remained visible.

## Auto review and OpenCode session routing (2026-10-15)

On DSH `0.2.0-rc.2`, enabling experimental Auto review exposed two separate failures:

- Upstream `classifyRisk()` calls `llm.stream()` without `sessionId`. The installed
  `dsh-llm-pi-ai` adapter forwards this field to pi-ai, whose OpenCode provider uses
  it for `x-opencode-session`. Ordinary DSH sessions exhibit the same missing field;
  this is not evidence that TheOne dropped a header from a normal worker request.
- If Auto is loaded after TheOne, its prepended gate can review a main-chat mirror
  before TheOne resolves it from the worker's result. The gateway's logged request
  may not contain the worker-only tool schema, yielding `pending native tool schema
  is missing or ambiguous`. In the regression test the worker body already ran once,
  while the main-chat tool card incorrectly recorded this error.

TheOne now restores its mirror gate at each participating tool dispatch and carries
the executing topic or runtime-owned descendant's identity through the asynchronous
pre-execute chain. Only a session-less `REVIEW_POLICY` auxiliary request on that agent's actual provider/model
receives the missing identity. Existing identities and loop-built requests are kept.
Real worker calls still pass through Auto; mirror cards receive their actual outcome.
This compatibility fix applies to TheOne topics and their live descendants, not
unrelated native DSH sessions or sessions merely claiming stored parent lineage.

`tests/auto-review.test.ts` loads the real DSH Auto, tools, session, permission and
approval services. Its deterministic model exposes missing identities and supplies
review decisions. It covers fresh/reused topics, late Auto loading, approval and
rejection, malformed review failures, concurrent native-session isolation, and an
upstream-supplied identity. Both reported errors were reproduced before the fix.

To verify the installed OpenCode provider's HTTP header conversion without account
credentials or live model requests:

```powershell
node e2e/opencode-session-probe.mjs .dsh-test/feedback-runtime
```

The probe uses the installed `opencode-go/deepseek-v4.1-flash` transport with a
loopback mock endpoint and a fake key: a missing session produces the simulated
400 `MissingSessionID`; providing one sends `x-opencode-session` and completes.
This verifies the real outbound header, not the availability of a live account.

## Permission and routing boundary regressions (2026-10-15)

Five additional failures were reproduced before repair, then covered in
`tests/permission-boundaries.test.ts`:

| Trigger | Fixed behavior |
| --- | --- |
| Tighten main-chat access during model generation or an in-flight review | Permission events synchronously update its active and set-aside workers; the next guarded tool body sees read-only and is denied. This does not retroactively stop an already-started command. |
| Reuse an Auto topic after switching main chat to custom full-access/ask | Copy the source's last real preset selection plus effective knobs; the topic no longer retains Auto. Never persist `custom` as a selected preset. |
| Delegate from a topic, including grandchildren | Resolve live runtime ownership and give each review its executing agent's own ID. Unrelated roots are unchanged. |
| Reload Auto after model assembly but before tool execution | Restore mirror ordering at Cordis's pre-dispatch boundary; the real call is reviewed once and its result is shown once. |
| Route, summarize, index history, or extract facts/terms with a provider requiring session routing | Carry the source gateway/topic/history ID as transport metadata. Standalone analysis with no source gets a fresh opaque ID, never another conversation's identity. |

The boundary tests use real DSH services with a deterministic model. The permission
reduction check uses a synthetic write guard reading DSH's current sandbox policy;
it makes no destructive filesystem or live-account calls. Separate controls cover
approval denial, malformed review responses, cancellation/recovery, existing IDs,
and concurrent unrelated sessions. Router, catalog and topic-card tests also verify
the source identity without adding it to the model-visible prompt or modifying the
source conversation log.

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
history catalog makes of an ordinary session, `[run] CMD` runs CMD with the bash tool, `[ask]` asks a three-option question (`[ask:N]` waits only N seconds, for DSH's timed question mode), `[call:TOOL] {json}` calls any tool (each marker acts once, not again when a notice wakes the session), `[project:NAME]` puts a new topic in that project folder; a goal round is read and completed through the goal tools.

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
| A topic hands over a file (`[call:present] {"files":[{"path":"readme.txt"}]}`) | Main chat's reply carries the same file card as an ordinary chat |
| A topic starts a subagent (`[call:subagent] {"description":"…","prompt":"…"}`), which reports back after the reply | Main chat shows DSH's own "Subtask status updated" card, then the topic's follow-up reply, as an ordinary chat does |
| `/plan` in main chat, then a message (`plan.mjs main`; `plan-exit.mjs` approves a plan) | The topic gets plan mode's instructions, as an ordinary chat's model does; after "Approve and run" both leave plan mode |
| A topic runs a command in the background (`[call:bash] {…,"run_in_background":true}`; `jobs.mjs`) | Main chat's header lists it as running ("1 background job running"), its live output opens there, and stopping it there kills it; when it ends, DSH's "Background task updated" card and the topic's follow-up appear |
| A topic reads an image (`[call:read_image] {"file_path":"red.png"}`; the probe model accepts images) | The same tool card and result as an ordinary chat |
| A background topic asks for approval while another reply runs (`ACCESS=仅可查看` with `mid.mjs`) | The approval prompt opens in main chat at once and names the topic; "allow once" lets it continue |
| While a reply runs (`[run] sleep 10`; `mid.mjs`): an interjection for another topic | That topic answers at once in the background; the reply is not mixed with it; main chat shows it after the reply, as its own turn |
| While a reply runs: an interjection about it, and a queued message for another topic | The interjection joins the reply (between its steps); the queued message's topic starts at once and is shown after |
| While a reply runs: a queued message whose topic asks a question (`CLICK=<option>`) | The choice window opens in main chat at once, headed with that topic's name; the answer reaches it |
| DSH's workspaces and archive afterwards | No TheOne session attached to a workspace; the archive holds only TheOne's sessions; none of the user's sessions archived |

## WeChat (all passed on 2026-10-13)

`node fake-ilink-server.mjs 3099` stands in for Tencent's iLink server. With DSH stopped, bind an account to it by
writing TheOne's `remote_links` row (`channel` `weixin`, `state` `{"account":{"botId":"bot-e2e-0001","token":"e2e-token","baseUrl":"http://127.0.0.1:3099","userId":"owner@im.wechat"},"enabled":true,"cursor":""}`)
into `<DSH_HOME>/theone/contexts.db`, then start DSH with `NO_PROXY=127.0.0.1`. Send as the owner with
`curl -X POST -d '{"text":"…"}' http://127.0.0.1:3099/control/say`; `GET /control/sent` lists what the bot sent. The fake numbers
messages from 1 each time it starts, and TheOne remembers the ids it delivered: after restarting the fake, rebind (or clear
`seen`) so new messages are not taken for repeats.

| Check | Expected |
| --- | --- |
| DSH starts with an account bound, no browser open | `notifystart`, then `getupdates`, without opening Settings |
| A message (`[topic:NAME] …`) while main chat is not loaded | Main chat wakes, routes it to the topic, shows "typing" (`sendtyping`); the topic's reply is sent back with the message's `context_token` |
| A message that needs approval (`[call:bash] {"command":"…","description":"…","sandbox_permissions":"danger-full-access","justification":"…"}`) | The approval text arrives in WeChat; replying `1` runs the command and the result comes back; `1` does not appear in main chat |
| Main chat in the browser afterwards | The WeChat messages and replies as ordinary turns |
| DSH restarted | Messages already answered are not delivered again |
| Settings → WeChat | Connected state with pause and logout; a login in progress shows a QR code that decodes to the server's `qrcode_img_content` |

