# WAC Local Test Server

Test server for Web Agent Context (WAC) integration. Serves a demo website with an embedded WebAssist chat iframe pointing to the real WebAssist server (port 8080).

## Quick Start

```bash
node tests/localServer/server.mjs
```

Then open http://localhost:3000 in your browser.

## Architecture

```
Port 3000 (Test website)          Port 8080 (WebAssist server)
├── /                             ├── /webAssist/mcp
│   ├── index.html (with iframe)  │   └── MCP tools (fetch-agent-context, etc.)
│   └── /agent-context.mjs        │
```

## Flow

1. Open http://localhost:3000
2. Iframe loads from port 8080
3. Iframe detects parent URL (http://localhost:3000)
4. Iframe calls `fetch-agent-context` with `siteUrl: http://localhost:3000`
5. WebAssist server fetches `http://localhost:3000/agent-context.mjs`
6. Module executes in sandbox, documents saved to `data/sites/localhost/`
7. Chat proceeds with loaded context

## Files

| File | Purpose |
|------|---------|
| `index.html` | Demo page with WebAssist iframe |
| `agent-context.mjs` | WAC module with AssistOS data |
| `server.mjs` | Static server on port 3000 |

## Custom Port

```bash
PORT=8080 node tests/localServer/server.mjs
```
