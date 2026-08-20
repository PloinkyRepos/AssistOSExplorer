---
title: DS011-testing
summary: Defines the DS011-testing contract for WebAssist.
---

# DS011-testing

## Introduction

This specification defines the active DS011-testing contract for WebAssist.

## Core Content

### DS008 - webAssist Testing

### Runner
- `node tests/runAll.mjs`

### Covered Areas
- Agent turn execution through `createWebAssistAgent(...).handleMessage({ siteId, sessionId, message })`.
- AKU location resolution at `$PLOINKY_WORKSPACE_ROOT/webassist-data/sites/<siteId>/.aku/`.
- `update-session` and `appendSessionTurn` persistence in session KU and event history.
- `loadAkuContext` behavior for profile, lead and AKU-backed history payloads.
- `webassist-lead` deterministic lead KU updates.
- `register-events` appends AKU events.
- `web_cli_history` returns parsed session turns from session KU events.
- `list-sites` MCP listing from `$PLOINKY_WORKSPACE_ROOT/webassist-data`.
- Local WAC fixture consistency: `tests/localServer/WAC.json` mirrors `tests/localServer/profiles/*.md` and links `tests/localServer/assistos-info/*.md`.
- Manifest guest access for embedded chat route and guest-callable MCP tool policy.

### Fixtures
Fixtures live under `tests/fixtures/seed-data/sites/demo-site/` and are copied into `webassist-data/sites/demo-site/` during tests.

## Conclusion

WebAssist must preserve the responsibilities and boundaries stated by this specification.
