# WAC Local Test Server

Test server for Web Agent Context (WAC) integration. Serves a demo website with a WAC.json file containing site information.

## Quick Start

```bash
node tests/localServer/server.mjs
```

Then open http://localhost:3000 in your browser.

## Architecture

```
Port 3000 (Test website)          Port 8080 (WebAssist server)
├── /                             ├── /webAssist/mcp
│   ├── index.html                │   └── MCP tools (fetch-wac, etc.)
│   └── /WAC.json                 │
```

## Flow

1. Open http://localhost:3000
2. Browser calls `fetch-wac` MCP tool with `siteUrl: http://localhost:3000`
3. WebAssist server fetches `http://localhost:3000/WAC.json`
4. WAC.json is validated (siteInfo, profilesInfo, contactInfo, siteMap)
5. WebAssist delegates AKU construction to opencode-agent via execute-task MCP tool
6. Knowledge units are stored under `data/sites/localhost/.aku/`

## Files

| File | Purpose |
|------|---------|
| `index.html` | Demo page |
| `WAC.json` | Static JSON with siteInfo, profilesInfo, contactInfo, siteMap |
| `server.mjs` | Static server on port 3000, serves WAC.json at /WAC.json |

## Custom Port

```bash
PORT=8080 node tests/localServer/server.mjs
```
