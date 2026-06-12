# DS003 - webAssist Integration and Loading

`webAssist` is a Node.js Ploinky agent with CLI, MCP, and embedded chat entry points.

## CLI
- Entry: `webAssist/src/index.mjs`.
- Required: `--site-id <siteId>`.
- Optional: `--session-id <id>`, `--json`, `--data-dir <dir>`, `--agent-root <dir>`.
- `-mcp` runs one request and exits.

Examples:
- `node src/index.mjs --site-id demo-site "Hello"`
- `node src/index.mjs -mcp --site-id demo-site --json "Hello"`

## MCP Tools
- `web_cli_chat`: requires `siteId` and `message`; accepts optional `sessionId`, `json`, `dataDir`, and `agentRoot`.
- `web_cli_history`: requires `siteId` and `sessionId`.
- `register-events`: requires `siteId`, `visitorId`, and `eventType`; accepts optional `sessionId`, `referrer`, `country`, `openedChat`, and `details`.
- `prepare-wac`: requires `siteUrl`, fetches and validates `<siteUrl>/WAC.json`, builds the AKU construction prompt including the WAC JSON, selects the OpenCode model, and delegates to `opencodeAgent.execute-task` with `{ prompt, projectDir, model }` only when the WAC cache is stale or the site AKU manifest is missing. `projectDir` is `<dataRoot>/sites/<siteId>`; the delegated `create-akus` skill creates `.aku/` inside that directory. The prompt tells `create-akus` to fetch every URL in `siteMap` and use the fetched content for document KUs. When `webAssist` is running in a container, localhost `siteMap` URLs are rewritten in the delegated prompt to `host.containers.internal` so the `opencodeAgent` container can reach the host test server.

## WAC Cache
- `prepare-wac` stores cache metadata in `<dataRoot>/wac-cache.json`.
- Cache entries are keyed by normalized website URL and include `siteUrl`, `siteId`, `wacTimestamp`, `updatedAt`, `projectDir`, and `akuDir`.
- `wacTimestamp` is the `Last-Modified` response header when present; otherwise it is a `sha256:` hash of the raw WAC JSON response body.
- A cache hit requires the same `wacTimestamp` and an existing `<projectDir>/.aku/aku.json`. On cache hit, `prepare-wac` returns success with `akuBuilt: false` and does not call `opencodeAgent`.
- For v1, invalidation tracks only `WAC.json`; changes behind `siteMap` URLs do not force a rebuild unless WAC changes.

`web_cli_chat` returns `{ siteId, sessionId, message }`.

## Embedded Chat
The iframe URL may include `siteId`. If `siteId` is absent and the widget can derive the parent site URL, it opens the chat UI immediately, disables message submission, shows the context-preparation loading message, and runs `prepare-wac` asynchronously. After `prepare-wac` returns a `siteId`, the widget switches to site-scoped `localStorage` keys and passes `siteId` to chat, history, and visitor-registration MCP calls.

## Runtime Flow
1. Resolve data root from `--data-dir` or `path.join(process.env.WORKSPACE_PATH, "data")`.
2. Configure `MarkdownDataStore` at `<dataRoot>/sites/<siteId>/`.
3. Load context from `config/`, `info/`, `profiles/`, `sessions/<sessionId>-profile.md`, `sessions/<sessionId>-history.md`, and `leads/`.
4. Execute `MainAgent` with the visitor-flow system prompt and `webassist-*` skill set.
5. Append the final user/agent turn to `sessions/<sessionId>-history.md` automatically.
