# DS010 - web-assist-chat

## Goal
Define the active plugin contract for the Web CLI chat integration.

## Plugin Identity
- **Plugin folder**: `webAssist/IDE-plugins/web-assist-chat/`
- **Config id**: `webassist-chat`
- **Component**: `web-assist-chat`
- **Presenter**: `WebAssistChat`
- **Type**: `global`
- **Settings component**: `webassist-settings`

## Runtime Surface
- Chat UI is served through:
  - `web-assist-chat.html`
  - `web-assist-chat.css`
  - `web-assist-chat.js`
- Settings generates Preview and iframe snippets targeting `web-assist-chat.html`.
- Iframe UX is launcher-based:
  - initial state is closed (chat icon visible),
  - click icon opens chat panel,
  - close button (`X`) in header closes panel.

## Runtime Contract
- MCP endpoint: `/mcps/webAssist/mcp` (always; no token-based routing)
- Tools:
  - `web_cli_chat` with `{ message, sessionId?, json: true }`
  - `web_cli_history` with `{ sessionId }`
- `web-assist-chat.js` handles:
  - message parsing/sanitization,
  - session persistence,
  - history hydration,
  - typing/send UI behavior.

## MCP Client
- Client module: `/MCPBrowserClient.js`
- Loaded dynamically via `import()`
- Calls `callTool()` for chat and history operations
- Parses tool responses to extract response text and sessionId
