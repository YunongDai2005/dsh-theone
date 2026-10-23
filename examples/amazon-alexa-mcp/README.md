# TheOne topic memory over MCP

An experimental, self-hosted Streamable HTTP server for the Amazon **Alexa+** track. It turns TheOne's topic organization into six host-callable tools, with persistent per-topic notes, safe retry receipts and version-checked correction of misfiled work. It is a local single-owner prototype. It does not connect to an Alexa device, claim Amazon certification or use AWS services.

## Submission version: TheOne 0.4.1

On October 23, this competition branch incorporated the exact TheOne `v0.4.1` release (`5e6f4e9b190c7773d080885bcdcbe02e033e2ffe`). The root package and plugin are version **0.4.1**. The separate MCP example keeps its own **0.1.0** version; these are different components, not competing labels for one executable.

The desktop plugin now offers choices before an ambiguous action, topic correction and merge suggestions, and corrected navigation when continuing or opening an archived topic. Run the plugin through its root instructions to see those features. This MCP example imports the current deterministic router from the same 0.4.1 source tree, but its SQLite notes and browser demonstration remain independent of DSH's live sessions. It does not expose the desktop UI or automatically share the desktop conversation database. A combined video must label which component is being shown.

The linked 90-second MCP video below was recorded on October 11 with the older 0.3.31 base. It remains evidence of that demonstration, not a recording of the 0.4.1 desktop interface. A replacement video must be attached to the existing Amazon submission before its deadline; editing this repository alone does not replace the video judges see.

## Run

Use Node.js **24+**. From this repository:

```sh
cd examples/amazon-alexa-mcp
npm ci --ignore-scripts
npm test
npm start
```

The endpoint is `http://127.0.0.1:3035/mcp`. `PORT` changes the port; `THEONE_MCP_DB` selects the separate SQLite database (default `.theone/topic-memory.db`, ignored by Git). The prototype does not open, modify or import your existing DSH database. Stop with Ctrl+C. No cloud subscription, model credential or Amazon developer account is needed for this local MCP server.

Use a host supporting MCP **2025-11-25** and Streamable HTTP. The official `@modelcontextprotocol/sdk@1.32.1` supplies the server and transport; the integration test initializes the actual HTTP endpoint with that protocol version and asserts the negotiated response. The entry point imports and invokes the SDK at runtime.

## One conversation, several kinds of work

The host first reads `list_topics`, then uses the user's intent to select or create a topic. `read_topic` returns only that topic's notes. `save_note` requires a stable request key so retrying a completed save returns its receipt rather than making a second note. Reusing the key with different content fails.

A bill for moving can be mentioned while planning a move but belong in the monthly budget. When the user corrects it, `move_note` moves the existing note and records the change atomically, without leaving a copy in the original topic. A stale note version is refused so one correction does not silently overwrite another. Retrying the original save after correction returns the same note's current topic and version.

`suggest_route` reuses the existing TheOne deterministic rules (`src/router.ts`). Its output is a hint, explicitly marked `existing-TheOne-rules`; it is not a new LLM inference. The rules can misclassify, especially action-versus-subject collisions. The host should ask when intent is ambiguous. A model-based or voice host remains future work; the demos below do not fabricate one.

## Reproducible demonstration

```sh
node demo.mjs
```

This starts a real HTTP server, connects the official SDK client, files a 480 EUR bill in the moving topic, shows the budget is empty, moves it after an explicit scripted correction, retries the original save and reads both topics. It is a **scripted MCP host** with synthetic data, not an Alexa device or a language model conversation. Its output demonstrates persistence operations and protocol calls, not routing accuracy.

The HTTP integration test also checks restart persistence, topic separation, retry conflicts, stale corrections, unknown topics, foreign Origins and untrusted Host headers. It uses no model calls. The test server/database are temporary and cleaned up.

For the browser demonstration host:

```sh
node demo-host.mjs
```

Open `http://127.0.0.1:3036`. The five buttons are explicit scripted user actions, making actual calls through the official MCP client to the separate HTTP server. They save a synthetic bill, correct its topic, replay the save, reject a stale correction and reread the stored workspaces. The page shows the returned receipts; it is not a language model or Alexa device. Its default persistent demo database is `.theone/demo-host.db`; set `THEONE_DEMO_DB` to a separate new path for a fresh demonstration. `DEMO_PORT` changes the host port. Both services stay on loopback, with Host and Origin checks. Stored note bodies are rendered with `textContent`, never HTML.

Public 90-second demonstration: https://youtu.be/mgPtqg8H8tk . Actual browser screenshots are held and edited for pacing; scripted inputs make real MCP calls. No Alexa device or LLM inference is shown.

## Current boundaries

- The server binds to loopback, validates Host headers using the SDK and rejects foreign Origins. Do not expose it through an unauthenticated public tunnel. Remote deployment would require TLS and per-user authorization.
- This is single-owner topic separation, not a multi-user security boundary. A connected local host can read all the owner's topics. Tool annotations are hints for hosts, not an authorization system.
- Note bodies are marked untrusted data; that alone does not guarantee a model will resist instructions embedded in a note.
- There is no terminal execution, arbitrary file access, payment tool or external service integration.
- No public hosting or Alexa-device integration is provided. Judges can run the source locally without credentials.

## Existing code and event work

The base TheOne repository history starts on September 30, 2026, within the event submission window. This extension reuses that plugin. The original branch started from the public build-fix commit `5e5e395`; the October 23 update incorporates the published `v0.4.1` tree and reuses its deterministic rule router. The HTTP entry point, tool schemas, independent SQLite memory, retry/correction workflow, official-client demos, browser host and HTTP verification were built on October 11, 2026, within the event's submission window. The 0.4.1 main-product improvements are shared product work, not claimed as exclusive Amazon features. Codex assisted with implementation, tests, demonstration capture and documentation. This source is covered by the repository's MIT license; third-party SDK dependencies retain their own licenses.

Official sources: [Amazon rules](https://amazonappdev2026.devpost.com/rules), [MCP TypeScript SDK v1 branch](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x).
