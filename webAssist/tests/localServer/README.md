# WAC Local Test Server

Test server for Web Agent Context (WAC) integration. Serves a demo website with a `WAC.json` file containing site information.

## Quick Start

```bash
node tests/localServer/server.mjs
```

Then open http://localhost:3000 in your browser.

## Architecture

```text
Port 3000 (Test website)          Port 8080 (WebAssist server)
├── /                             ├── /webAssist/mcp
│   ├── index.html                │   ├── web_cli_chat
│   └── /WAC.json                 │   ├── web_cli_history
│                                │   ├── register-events
│                                │   └── list-sites
```

## Flow

1. Open http://localhost:3000
2. Open the embedded chat with `siteId=localhost-3000`.
3. WebAssist chat requests load AKU-backed session context and history.
4. Runtime tools persist sessions/leads/events into `$PLOINKY_WORKSPACE_ROOT/webassist-data/sites/localhost-3000/.aku/`.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Demo page |
| `WAC.json` | Static JSON with siteInfo, profilesInfo, contactInfo, siteMap |
| `server.mjs` | Static server on port 3000, serves WAC.json at `/WAC.json` |

## Custom Port

```bash
PORT=8080 node tests/localServer/server.mjs
```
