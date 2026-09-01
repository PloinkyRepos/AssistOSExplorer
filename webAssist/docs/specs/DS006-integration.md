---
title: DS006-integration
summary: Defines the DS006-integration contract for WebAssist.
---

# DS006-integration

## Introduction

This specification defines the active DS006-integration contract for WebAssist.

## Core Content

### DS003 - webAssist Integration and Loading

`webAssist` is a Node.js Ploinky agent with CLI, MCP, and embedded chat entry points.

### CLI
- Entry: `webAssist/src/index.mjs`.
- Required: `--site-id <siteId>`.
- Optional: `--session-id <id>`, `--json`.
- `-mcp` runs one request and exits.

### MCP Tools
- `web_cli_chat`: requires `siteId` and `message`; accepts optional `sessionId` and `json`.
- `web_cli_history`: requires `siteId` and `sessionId`.
- `register-events`: requires `siteId`, `visitorId`, and `eventType`; accepts optional `sessionId`, `referrer`, `country`, `openedChat`, and `details`.
- `list-sites`: returns known site IDs from `$WEBASSIST_DATA_ROOT`.

### Runtime Flow
1. Require and resolve the data root from `process.env.WEBASSIST_DATA_ROOT`.
2. Resolve `$WEBASSIST_DATA_ROOT/sites/<siteId>/.aku/`.
3. `loadAkuContext` loads session state, relevant AKU search results, and event-driven conversation history.
4. `webassist-session` and `webassist-lead` persist to the site AKU.

### Embedded Chat
The iframe URL must include `siteId`. If `siteId` is missing, chat is disabled and a user-facing message is shown.

`web_cli_chat` returns `{ siteId, sessionId, message }`.

## Conclusion

WebAssist must preserve the responsibilities and boundaries stated by this specification.
