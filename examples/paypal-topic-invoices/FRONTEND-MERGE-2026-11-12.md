# Repaired backend and new frontend merged — November 12, 2026

The new Invoice Desk frontend is now part of the original repaired `TheOne-PayPal-preview-20261112` worktree on `codex/hackathon-paypal-ai`. Port 3071 runs this example directory. The standalone frontend directory is retained as a previous copy and is no longer the source of the active preview.

## Sources and changes

- Backend: the completed Codex audit repair checkpoint in this worktree. SHA-256 comparison confirms all 17 existing business/backend/test modules outside the preview launcher and backend verifier are unchanged.
- Frontend: `TheOne-PayPal-frontend/index.html`, SHA-256 `c19964a46a3ca9b74e1d3df7ea11a649cdd830b83d5f85d6962628897a37cf59`. This file was merged without changing its contents.
- The old frontend is preserved as `design-reference/2026-11-12/index.html`. Its historical SHA-256 remains `c4bdef50513582e5ef830a7917d916af33e3c581e82697327c8cb9952f493600`.
- The backend verifier now checks the active merged design baseline instead of enforcing the superseded frontend freeze. The old audit and design records remain historical evidence.
- `verify-ui.mjs` and `npm run verify:ui` provide repeatable browser checks against this app, using an isolated in-memory database and simulated providers.
- The preview defaults to port 3071 and `.data/preview-invoice-desk.sqlite`. The current standalone frontend's database was copied with SQLite backup, passed integrity checking, and matched all 13 source tables. Earlier frontend and backend databases remain intact.

## Verification on the merged app

| Check | Result |
| --- | --- |
| Backend automated tests | 88 passed |
| HTTP/SQLite backend demonstration | 16 steps passed |
| Chrome UI integration checks | 16 passed |
| Uncaught browser errors | 0 |
| Original repaired business/backend/test modules | Unchanged |
| Real model or PayPal calls during this merge | 0 |

Browser checks cover drafting, budget isolation, selected-invoice revisions, multiple-draft isolation, manual edits, project/recipient correction, local discard, explicit simulated approval, client clarification, response-loss request replay, dark-theme persistence, mobile layouts at 320/375/430/768px, drawer focus, desktop resizing, and long-content wrapping.

## Run

Node.js 24 or newer is required. The server and backend tests need no npm dependencies.

```sh
npm run preview
# http://localhost:3071
npm test
npm run verify:backend -- .data/backend-verification.json
```

The optional UI verifier needs an installed Playwright package (including its test API) and Chromium. With those available to Node:

```sh
npm run verify:ui
```

An existing installation can be used without changing the app's dependency tree by setting `PLAYWRIGHT_MODULE` to the absolute Playwright package directory. `PLAYWRIGHT_EXECUTABLE_PATH` optionally selects an existing Chrome/Chromium executable. The optional first argument to `verify-ui.mjs` selects the JSON evidence file; the default is ignored `.data/ui-verification.json`.

## Remaining evidence boundaries

This preview is offline and simulated. Prior genuine model evidence belongs to the earlier repair checkpoint; no new model run was claimed for this frontend merge. At this merge checkpoint real PayPal Sandbox verification still required credentials; a later [five-step Sandbox run](evidence/sandbox-2026-11-12.json) passed. The remote update/delete/publication endpoints remain in the repaired backend and are still API-only; the frontend presents local review and unsent-draft creation. No new public demo video, deployment, competition update, commit or push was made.
