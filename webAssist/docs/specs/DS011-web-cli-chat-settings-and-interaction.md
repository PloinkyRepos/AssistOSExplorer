# DS011 - web-assist-chat settings and interaction contract

## Goal
Define `webassist-settings` behavior and `web-assist-chat` runtime behavior for the current architecture.

## Settings surface (`webassist-settings`)

### Available configuration fields
1. **Site ID** (`#webassistSiteId`)
   - Source: MCP `list-sites`.
   - Required at runtime: chat surface is disabled if `siteId` is missing.
2. **Theme** (`#webassistTheme`)
3. **Header Text** (`#webassistHeaderText`)
4. **Subheader Text** (`#webassistSubtitleText`)
5. **Chat Background** (`#webassistChatBackground`)
6. **User Bubble** (`#webassistUserBubble`)
7. **Agent Bubble** (`#webassistAgentBubble`)
8. **Header Color** (`#webassistHeaderColor`)

### Base URL
- Auto-derived from `window.location.origin`.

### Derived output
- Embed URL format:
  - `{origin}/webAssist/IDE-plugins/web-assist-chat/web-assist-chat.html?{query}`
- `query.siteId` is required.

### Settings actions
1. **Admin Webchat**
   - Opens `{origin}/webchat?agent=achilles-cli&workspace-dir=webassist-data` in a new tab.
2. **Preview Chat**
   - Opens embed URL in a new tab.
3. **Copy iframe code**
   - Copies the iframe snippet for current settings.

## `web-assist-chat` runtime behavior
- Reads `siteId` from URL query only.
- If `siteId` is missing:
  - composer is disabled,
  - an error message is shown,
  - no MCP calls are made.
- Uses MCP tools:
  - `web_cli_chat` with `{ siteId, message, sessionId?, json: true }`
  - `web_cli_history` with `{ siteId, sessionId }`
  - `register-events` with `{ siteId, visitorId, eventType, ... }`
- Uses `/MCPBrowserClient.js` against `/webAssist/mcp`.
- No `prepare-wac` flow exists in the embedded runtime.

## MCP contract
- `list-sites` returns `{ sites, count, dataRoot }`.
- `web_cli_chat`, `web_cli_history`, and `register-events` require `siteId` and return session-oriented AKU-backed data.
