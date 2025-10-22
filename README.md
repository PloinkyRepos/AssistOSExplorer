# AssistOS Explorer

AssistOS Explorer is a lightweight MCP-capable agent that exposes the official Model Context Protocol filesystem server together with an explorer-style web interface. It is intended to run inside Ploinky. The UI is powered by the embedded WebSkel framework and reuses the router-served `MCPBrowserClient` for all MCP calls.

## Repository Layout
- `explorer/manifest.json` – container definition for the agent (Node 20, installs npm deps, runs the filesystem MCP server).
- `explorer/filesystem-http-server.mjs` – HTTP wrapper that adapts the official `@modelcontextprotocol/server-filesystem` to the Streamable HTTP transport used by Ploinky.
- `explorer/index.html`, `styles.css`, `main.js` – WebSkel bootstrap and UI assets.
- `explorer/services/assistosSDK.js` – small wrapper around the router-served MCP browser client; cached per-agent sessions.
- `explorer/package.json` – declares the MCP filesystem dependency.   

## Prerequisites
- Node.js 20+
- npm

## Running with Ploinky
1. From the `ploinky` workspace, enable the repo (if not already present) and the agent in **global** mode so static assets point at your checkout:
   ```bash
   p-cli enable repo fileExplorer
   p-cli enable agent fileExplorer/explorer global
   ```
2. Start the workspace (first run installs dependencies inside the container):
   ```bash
   p-cli start explorer 8080
   ```
3. Open the explorer UI via the router (replace the port if different):
   - `http://127.0.0.1:8080/explorer/index.html`
   - MCP requests are proxied at `http://127.0.0.1:8080/mcps/explorer/mcp`

4. Optional: to rebuild container state after UI changes run `p-cli refresh agent explorer` then `start`.

## Local Development Notes
Development happens against the Ploinky router; no standalone proxy is required.

## MCP Endpoints
All filesystem features are exposed through MCP tools on `/mcps/explorer/mcp`. Sample calls while the proxy is running:
```bash
curl -s -X POST http://127.0.0.1:8080/mcps/explorer/mcp \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "list_directory", "path": "/" }'

curl -s -X POST http://127.0.0.1:8080/mcps/explorer/mcp \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "get_file_info", "path": "/package.json" }'
```

## Troubleshooting
- **Port already in use:** stop any process bound to the port (`lsof -ti tcp:8080 | xargs kill`).
- **Permission errors:** ensure the working directory exists and Node has read access.
- **Empty responses:** verify the MCP server container is running inside Ploinky and reachable at the configured port.
- **Hidden files missing:** toggle the “Show hidden files” checkbox in the UI; the preference is stored in `localStorage`.
