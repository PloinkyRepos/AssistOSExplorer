# WebAssist Local Test Server

Test server for the embedded WebAssist iframe against pre-existing site data.

## Quick Start

```bash
node tests/localServer/server.mjs
```

Then open http://localhost:3000 in your browser.

## Architecture

```
Port 3000 (Test website)          Port 8080 (WebAssist server)
├── /                             ├── /webAssist/mcp
│   └── index.html                │   └── MCP tools
```

## Flow

1. Open http://localhost:3000
2. The iframe URL supplies `siteId`
3. WebAssist loads existing AKUs from the configured data directory

## Files

| File | Purpose |
|------|---------|
| `index.html` | Demo page |
| `server.mjs` | Static server on port 3000 |

## Custom Port

```bash
PORT=8080 node tests/localServer/server.mjs
```
