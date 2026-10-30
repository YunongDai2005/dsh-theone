# Run TheOne with Nebius and NVIDIA Nemotron

This demo uses NVIDIA Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) through the Nebius Token Factory inference API. TheOne calls the model at runtime for both topic routing and each topic's independent background worker. The interface runs locally in DeepSeek Harness; no GPU or Nebius compute deployment is required.

## Source and demonstration versions

The existing contest branch was updated on October 30 to TheOne **0.4.5**, based on release commit `10f196d70d69dd5e44ffe8bbdac64bc70b57f0c7`. This includes the current setup flow, topic-session sidebar setting and DSH compatibility fixes. The original Nebius launcher and separate local profile are retained. The 95-second submitted demonstration and October 10 live integration evidence were recorded with **0.3.31**; they do not demonstrate the later 0.4.x controls or appearance. The updated source passes 423 offline plugin tests, type checking and plugin packaging. The isolated DSH 0.2.1-rc.2 CLI successfully resolves the updated Nebius/plugin configuration with `--dump-config`; that check starts no chat or model call. This source update does not replace the existing video or assert a new model run. Codex assisted the merge, compatibility checks and documentation.

## Setup

Use Node.js 24 or newer and a Nebius Token Factory API key with available inference credits. From this repository:

```sh
npm ci --ignore-scripts
npm install --prefix .dsh-test/nebius-runtime --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-rc.2
npm run build
```

The CLI is installed separately so npm does not re-resolve the plugin's locked DSH development dependencies. The launcher first uses this isolated CLI, then falls back to an existing root installation.

Set `OPENAI_API_KEY` to your Nebius key using your shell or secret manager. Do not commit it. Then start:

```sh
node scripts/start-nebius-demo.mjs
```

Open the authenticated local URL printed by DSH. Open **TheOne · Main chat** and choose **Off** for reasoning. The backend model selector should show **Nemotron 3 Super**.

Version 0.4.5 displays a setup flow on its first open. For this isolated demonstration, choose **Set up later** to retain the launcher's settings. If completing the flow, decline organizing earlier chats; enabling that option changes the demo's bounded history configuration. Topic sessions now appear in the sidebar by default. Choose **Topic list** in setup, or enable **Hide topic sessions** in TheOne settings, if you prefer the earlier layout. These are setup instructions, not additional live model validation.

The launcher creates a separate profile and topic database under `~/.theone-nebius-demo`. It binds only to `127.0.0.1:3019`. To choose another data directory or port, set `THEONE_NEBIUS_HOME` or `THEONE_NEBIUS_PORT`. Existing DSH conversations are not imported into this demo. Historical indexing and topic grouping are disabled to keep background inference bounded; normal TheOne installations support those features.

## Try three topics in one chat

Send these messages in order, allowing each reply to finish:

1. "I'm designing a book-notes website. Remember these three fields: title, author, notes. Reply briefly in English."
2. "I'm planning a two-day trip to Hangzhou next weekend. My budget is 1,500 yuan. Remember the budget and reply briefly in English."
3. "I'm getting back into running. My weekly target is 20 km. Remember the target and reply briefly in English."
4. "For the book-notes website, what were the three fields? Reply in English with only the field names."

The first three messages should create separate topics. The fourth should return to the website topic and recall its fields. Open **Topic workspaces** to inspect the independent topic sessions.

## Integration details and limits

The OpenAI-compatible endpoint is `https://api.tokenfactory.nebius.com/v1/`. DSH's `llm-pi-ai` adapter handles inference. The launcher sets `workerProvider` to `nebius`, `routerTransport` to `dsh`, and uses the same Super model for routing and workers. DSH reasoning controls map to Nebius's `chat_template_kwargs.enable_thinking`; the initial demo uses thinking disabled. Each completion is capped at 2,048 output tokens and retries are limited to one.

On 2026-10-10, the full application completed four synthetic requests spanning website notes, travel, running, and returning to website notes. The runtime log recorded three different background worker sessions. This was a small integration check, not a measurement of general routing accuracy. Topic routing can still select the wrong topic or create duplicates. Tools, approval flows and large-scale history import were not exercised in that integration check.

Nebius serves the NVIDIA model used in those calls. The demo uses no Tavily calls and no Nebius AI Cloud deployment.
