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

`web_cli_chat` returns `{ siteId, sessionId, message }`.

## Embedded Chat
The iframe URL must include `siteId`. The widget uses site-scoped `localStorage` keys and passes `siteId` to chat, history, and visitor-registration MCP calls.

## Runtime Flow
1. Resolve data root from `--data-dir` or `path.join(process.env.WORKSPACE_PATH, "data")`.
2. Configure `MarkdownDataStore` at `<dataRoot>/sites/<siteId>/`.
3. Load context from `config/`, `info/`, `profiles/`, `sessions/<sessionId>-profile.md`, `sessions/<sessionId>-history.md`, and `leads/`.
4. Execute `MainAgent` with the visitor-flow system prompt and `webassist-*` skill set.
5. Append the final user/agent turn to `sessions/<sessionId>-history.md` automatically.
