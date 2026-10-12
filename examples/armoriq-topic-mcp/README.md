# Single-topic notes MCP transport

This companion exposes two real SQLite note operations over the HTTP/SSE format described by the [ArmorIQ MCP guide](https://docs.armoriq.ai/sdk/mcp-directory/mcp-format/index). It imports `scopedAction` from the plugin so discovered action names match the existing DSH guard. The operator fixes one synthetic topic and database at startup; callers cannot choose another topic or execute shell commands.

**Status:** three loopback integration tests pass for discovery, actual persistent notes, authentication and cross-topic rejection. This is not evidence of ArmorIQ cloud registration or enforcement. The service does not invoke the cloud guard or mint tokens. The existing DSH pre-execution guard remains separate and must continue to reject calls without a matching server policy.

## Local preparation

Use Node 24 and the repository's built distribution. From the repository root:

```sh
npm ci --ignore-scripts
npm run build:armoriq
node --test examples/armoriq-topic-mcp/test/server.test.mjs
```

Configure `THEONE_MCP_DATABASE_PATH` as an absolute path to a new synthetic demonstration database, `THEONE_MCP_TOPIC` as one operator-owned demo topic, and `THEONE_MCP_BEARER_TOKEN` as a private random token of at least 32 characters. Supply these privately through the process environment, never a public command, repository file or browser URL. Then run:

```sh
node examples/armoriq-topic-mcp/server.mjs
```

The command listens only on `127.0.0.1:3059`. `POST /mcp` requires `Authorization: Bearer <private token>` and JSON requests; browser origins are rejected. `GET /health` discloses no notes and explicitly reports cloud verification as false. A process stops accepting authenticated MCP requests after 200 calls. Requests over 96 KiB are rejected; note keys are 1–100 characters and text is limited to 20,000 characters. SQL parameters are bound, and only the two discovered scoped actions exist.

## Remaining gates

This loopback endpoint is not reachable by a remote registry. Establish supported hosting or a documented local transport before registration; do not enter a local filesystem path as a cloud executable. Any public hosting/authentication grant requires review at its concrete action step. Register only the actual two discovered tools, bind a narrow operator/topic policy, verify activation and run genuine cloud allow/deny calls. Never register an unrestricted placeholder, claim local tests as cloud success, or attach a private user notes database to the demonstration.

Codex assisted implementation and tests. No provider credentials, private notes, remote permissions, actual cloud result or competition submission are included.
