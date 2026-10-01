# TheOne v0.2 web client report

English | [简体中文](./plugin-v0.2.zh.md)

September 30, 2026. This release added a browser client to the CLI implementation accepted in v0.1. This is a historical report; see the [current README](../README.md) for later behavior.

## v0.2.1 installation fix — October 1, 2026

GitHub installation packages files listed in `package.json`, but the earlier repository ignored `dist`, leaving installed packages without backend and client entry points. Compiled artifacts are now committed. CI rebuilds and checks them for consistency; installation requires no lifecycle scripts.

The default database is `$DSH_HOME/theone/contexts.db`, or `~/.dsh/theone/contexts.db` when `DSH_HOME` is unset.

Changing a web session’s model does not modify the agent’s initial options. Routing now uses the model in the current turn’s prompt assembly, allowing regular sessions to switch into TheOne and back. Preview assembly does not override active routing. Real DSH integration tests cover the default database and web model switching; all 51 tests passed.

## Behavior

- Main chat is pinned above the ordinary session browser, independently of its update-time ordering.
- Light mode uses a saturated orange glow at low opacity; dark mode uses pale blue. There is no looping animation.
- The wordmark combines a light “The,” a rounded, slightly tilted “One,” and a small light dot.
- Opening the entry creates or restores the same gateway, selects `theone/gateway`, and opens the native DSH conversation.
- The same browser retains gateway identity after refresh. Clearing browser storage or changing browsers may create another gateway. Topic state and workers remain on the server.
- Repeated clicks share creation work. Superseded navigation does not pull the user back after an asynchronous operation. Retries reuse the reserved session ID to avoid duplicates after uncertain RPC results.

## Integration

The package declares `dsh.client.platform: web` and a compiled `./client` export. It waits for DSH’s `sidebar.panellist` and `main` slots through `slots.inject`, and uses the native session controller, model selection, and UI workspace navigation. CSS targets sidebar buttons carrying the plugin’s own marker, without relying on generated DSH class names. Disabling the plugin removes its styles and entries.

The native workspace browser, session list, and search remain in use. Browser-local gateway identity contains no chat text, API keys, or database paths.

## Validation

Type checking and backend/client builds passed. All 49 tests passed, including seven new cases covering gateway recovery, concurrent clicks, navigation cancellation, model preparation failures, uncertain RPC results, and storage failures.

An isolated local web profile installed the archive through native `plugin add`. Browser tests verified initial gateway creation in a workspace, automatic TheOne model selection, a real DeepSeek Flash reply, recovery after refresh, opening from a collapsed sidebar, and both light/orange and dark/blue themes. API tests allowed only TheOne metadata tools; those restrictions were not included in the release package.

Tool cards, token-by-token streaming, worker approval forwarding, and image output retained the v0.1 limitations and were outside this acceptance test.
