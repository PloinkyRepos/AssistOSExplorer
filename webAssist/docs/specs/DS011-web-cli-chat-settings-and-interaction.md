# DS011 - web-assist-chat settings and interaction contract

## Goal
Define, in full detail, what `webassist-settings` can configure and how each setting affects `web-assist-chat`, plus how users interact with `web-assist-chat` at runtime.

## Relevant files
- `webAssist/IDE-plugins/web-assist-chat/webassist-settings/webassist-settings.html`
- `webAssist/IDE-plugins/web-assist-chat/webassist-settings/webassist-settings.js`
- `webAssist/IDE-plugins/web-assist-chat/web-assist-chat.html`
- `webAssist/IDE-plugins/web-assist-chat/web-assist-chat.js`
- `webAssist/IDE-plugins/web-assist-chat/config.json`

## Settings surface (`webassist-settings`)

### Available configuration fields
1. **Theme** (`#webassistTheme`)
   - Allowed values: `light`, `dark`, `aqua`, `forest`, `amethyst`
   - Default: `light`
   - Each theme preset provides a coordinated palette for background, user bubble, agent bubble, and header colors.
   - On change, color fields are reset to the selected theme's defaults.

2. **Header Text** (`#webassistHeaderText`)
   - Default: `WebAssist Assistant`
   - Max length: `100`
   - Empty/whitespace falls back to default when URL/snippet is generated.

3. **Subheader Text** (`#webassistSubtitleText`)
   - Default: `Embedded preview`
   - Max length: `120`
   - Empty/whitespace falls back to default when URL/snippet is generated.

4. **Chat Background** (`#webassistChatBackground`)
   - Type: hex color (`#RRGGBB`)
   - Invalid values are rejected and previous valid/default value is kept.

5. **User Bubble** (`#webassistUserBubble`)
   - Type: hex color (`#RRGGBB`)
   - Invalid values are rejected and previous valid/default value is kept.

6. **Agent Bubble** (`#webassistAgentBubble`)
   - Type: hex color (`#RRGGBB`)
   - Invalid values are rejected and previous valid/default value is kept.

7. **Header Color** (`#webassistHeaderColor`)
   - Type: hex color (`#RRGGBB`)
   - Invalid values are rejected and previous valid/default value is kept.

### Base URL auto-configuration
- No Base URL input field exists in the settings form.
- The Base URL is auto-derived from `window.location.origin` at runtime.
- All actions that previously required a valid Base URL now use the browser's current origin.
- If `window.location.origin` is unavailable or empty, actions report an appropriate error.

### Derived output from settings
- Embed URL format:
  - `{origin}/webAssist/IDE-plugins/web-assist-chat/web-assist-chat.html?{query}`
- Query parameters included:
  - `theme`
  - `headerText`
  - `subtitleText`
  - `chatBackground`
  - `userBubble`
  - `agentBubble`
  - `headerColor`
- Generated iframe snippet format:
  - `<iframe src="...">` with `title`, `loading="lazy"`, fixed style, `allow="clipboard-write"`.

### Settings actions
1. **Admin Webchat**
   - Opens `{origin}/webchat?agent=webAdmin` in a new tab, where `origin` is `window.location.origin`.
   - Requires available browser origin.

2. **Preview Chat**
   - Uses `{origin}/webAssist/IDE-plugins/web-assist-chat/web-assist-chat.html?{query}` as the embed URL.
   - Opens embed URL in a new tab.
   - Requires available browser origin.

3. **Copy iframe code**
   - Builds iframe snippet using embed URL derived from `window.location.origin` and current settings.
   - The iframe snippet textarea is user-editable (not readonly).
   - Copies iframe snippet to clipboard.
   - Uses `navigator.clipboard.writeText` when available, else `execCommand('copy')`.
   - Requires available browser origin.

### Iframe snippet textarea
- Element: `#webassistIframeSnippet`
- User-editable (not readonly).
- Automatically populated when settings change.
- Users can freely modify the content before copying.

### Status feedback messages
- Error (missing origin):
  - `Unable to determine browser origin.`
- Success:
  - `Admin webchat opened in a new tab.`
  - `Preview opened in a new tab.`
  - `Iframe code copied to clipboard.`
- Copy failure:
  - `Failed to copy. Select snippet and copy manually.`

## `web-assist-chat` runtime behavior

### UI structure and interaction
- Surface has:
  - launcher button (`#chatLauncher`) and panel wrapper (`#chatPanel`) for embed mode,
  - header (`#chatTitle`, `#chatSubtitle`),
  - close button (`#chatClose`) in the top-right of header,
  - messages container (`#chatMessages`),
  - typing indicator (`#typing`),
  - composer form (`#chatComposer`),
  - input (`#chatInput`),
  - send button (`#chatSend`).
- Visibility behavior:
  - embed mode starts closed (launcher visible, panel hidden),
  - launcher click opens panel,
  - close button click hides panel.
- Input behavior:
  - `Enter` submits,
  - `Shift+Enter` keeps multiline input,
  - textarea auto-resizes up to `160px`.
- Pending state:
  - send button + input are disabled while request is in flight.

### Theme and visual configuration intake
- `web-assist-chat` reads URL query params and applies CSS custom properties:
  - `--chat-bg`, `--chat-user`, `--chat-agent`, `--chat-header`
- Existing settings fields also drive additional surfaces (without adding extra settings controls):
  - `chatBackground` also styles composer and input backgrounds,
  - `userBubble` also styles the send button as a **solid** color,
  - `agentBubble` is reused for input border styling,
  - text colors are auto-derived for contrast on agent messages, input text, body text, and send button label.
- Header title source: `headerText` query param with fallback to `WebAssist Assistant`.
- Subtitle source:
  - `subtitleText` query param (if present and non-empty),
  - otherwise fallback:
    - embed entrypoint: `Embedded preview`
    - plugin presenter mode: `Context-aware website chat`

### MCP interaction contract
- MCP client module: `/MCPBrowserClient.js`
- Endpoint: `/mcps/webAssist/mcp` (always; no token-based routing)
- Tools:
  - `web_cli_chat` with `{ message, sessionId?, json: true }`
  - `web_cli_history` with `{ sessionId }`
- Chat response parsing:
  - accepts plain JSON or JSON wrapped in text,
  - extracts assistant text from `message`/`response`/raw output,
  - strips CLI noise lines (`Session ID`, `Type exit...`, `you>` prompts).

### Session and history behavior
- Session storage key:
  - `webassist-global-chat:sessionId` (single global key for all tabs and modes)
- Persistence:
  - `localStorage` is used (not `sessionStorage`), so the `sessionId` survives tab close and is shared across all open tabs in the same browser.
- On successful chat response:
  - if tool returns `sessionId`, it is persisted to `localStorage`.
- On startup:
  - if a stored `sessionId` exists, `web_cli_history` is called once to hydrate prior messages.
  - hydration is skipped if conversation messages already exist in the DOM.
- On unload:
  - MCP client is closed.

### Message rendering rules
- User and agent messages are appended as `.chat-message.user` / `.chat-message.agent`.
- Message content is rendered as text (`textContent`), not HTML.
- Typing indicator is appended/removed around async chat calls.
- Errors are shown as agent messages:
  - chat call: `Error: ...`
  - history load: `Error loading history: ...`

## Plugin-level integration (`config.json`)
- `id`: `webassist-chat`
- `component`: `web-assist-chat`
- `presenter`: `WebAssistChat`
- `type`: `global`
- `settings`: `webassist-settings`
- `autoPin`: `false`
- `location`: `[]`

This means the same runtime file (`web-assist-chat.js`) supports:
- standalone embed page usage (`web-assist-chat.html`), and
- presenter lifecycle usage (`WebAssistChat` class).
