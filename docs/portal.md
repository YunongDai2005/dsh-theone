# TheOne beyond DSH: one chat over Claude Code and Codex

Status: design agreed in principle, technical spike next (`experiments/portal-spike`). Nothing here
ships yet.

## What it is

The user already has Claude Code and/or Codex installed and signed in. They open TheOne (one
command, a local page in the browser) and see one chat. Each message goes to the topic it belongs
to; each topic is worked on by a real Claude Code or Codex session in the background, and its
reply, tool calls and permission prompts show up in the one chat. The user never picks a session.

## Principles (same as the DSH plugin)

- **Only organise, never change.** The user's own sessions are read, never written. Turning TheOne
  off leaves Claude Code and Codex exactly as before; turning it on again brings everything back.
- **No extra setup.** Uses the logins Claude Code and Codex already have. No API key required.
- **Seamless.** No confirmations; organising happens in the background.

## How

| Part | Decision |
| --- | --- |
| Reading old sessions | Read-only from `~/.claude/projects/**.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl`. Only sessions active in the last **30 days** are organised up front; older ones on demand (a reference that matches nothing). Organised into topics with the existing history-catalog logic (8 exchanges per model call, fingerprints so unchanged sessions are skipped). |
| Driving sessions | Agent Client Protocol (ACP): `@agentclientprotocol/claude-agent-acp` (Claude Agent SDK) and `@agentclientprotocol/codex-acp` (Codex App Server). One client, both agents; streaming, tool calls and permission requests come through the protocol. |
| Continuing an old session | **Fork** it (`session/fork`): the topic gets a new session carrying the old one's full history; the original is untouched. Fallback where fork is missing: a new session with a briefing written from the old one. |
| Routing model | Selectable. Default **borrow the signed-in agent** (`claude -p` / `codex exec`, smallest model, nothing persisted); optional own API key (fast, cheap); optional local model (Ollama); rules only as fallback. Defaults chosen by InterleaveBench accuracy, latency and cost. |
| Interface | Local web app (`npx theone`), the DSH main chat and topic workspaces reused. |

## Open questions the spike answers

1. Session files: formats, how many active in 30 days, estimated tokens to organise them.
2. Borrowed routing: latency and validity of `claude -p` / `codex exec`, and that it leaves no
   session behind (`--no-session-persistence`, `--ephemeral`).
3. ACP: capabilities of each adapter (load, resume, fork), streaming, one permission request
   answered from our side, resuming after a restart, fork leaving the original unchanged.
4. Which quota borrowed calls and ACP sessions draw from (subscription, SDK credit, API).
5. TheOne's own topic sessions will show in `claude --resume` / Codex's session list for that
   project. To be decided after the spike how to keep them out of the user's lists.

## Spike results so far (2026-10-08, Claude Code 2.1.293, claude-agent-acp 0.87.0)

Run in a cloud container signed in to Claude; Codex not signed in there, so its half runs on a Mac.

| Check | Claude | Codex |
| --- | --- | --- |
| Adapter starts, capabilities | load, resume, fork, list, close, delete | load, resume, fork, list, close, delete; auth: ChatGPT or API key |
| Streaming (message chunks, tool calls, usage) | yes | needs sign-in |
| Permission request answered from TheOne's side | yes ("Write hello.txt" → allow once) | needs sign-in |
| Fork keeps full history, original record untouched | yes; the fork must be resumed before its first prompt; Claude Code itself adds a generated title to the original a few seconds after a turn, unrelated to the fork | needs sign-in |
| Pick a session up again after restarting the adapter | yes (resume) | needs sign-in |
| Borrowed routing, `claude -p --model haiku --no-session-persistence` | 4.8 s per call, 3/5 right on 5 invented cases, 0 session files left | needs sign-in |
| Organising old sessions | this container's one transcript: 286 exchanges → about 36 calls, 0.16M input tokens | — |

Notes:
- The adapter logs "Unexpected case" for message types newer than it knows (`post_turn_summary`,
  `autocompact_state`): Claude Code moves faster than the adapter. Pin versions and test before
  upgrading either.
- Borrowed routing through `claude -p` is too slow to be the default as is (a process start and
  the agent harness per message). To try: a warm, long-lived routing session; or default to an own
  key with borrowing as the zero-setup fallback. Measure on an InterleaveBench subset before deciding.
