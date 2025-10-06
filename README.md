# AssistOS Explorer

AssistOS Explorer is a lightweight MCP-capable agent that exposes the official Model Context Protocol filesystem server together with an explorer-style web interface. You can run it inside Ploinky or launch it stand-alone while developing locally.

## Repository Layout
- `tstServer.mjs` – A simple Node.js server for local testing. It serves the static UI files and proxies requests to the MCP filesystem server.
- `explorer/manifest.json` – container definition for the agent (Node 20, installs npm deps, runs the filesystem MCP server).
- `explorer/filesystem-http-server.mjs` – HTTP wrapper that adapts the official `@modelcontextprotocol/server-filesystem` to the Streamable HTTP transport used by Ploinky.
- `explorer/index.html`, `styles.css`, `app.js` – explorer UI served as static assets.
- `explorer/package.json` – declares the MCP filesystem dependency.

## Prerequisites
- Node.js 20+
- npm

## Running with Ploinky
1. From the `ploinky` workspace, enable the agent:
   ```bash
   p-cli enable agent explorer
   ```
2. Start the workspace (first run installs dependencies inside the container):
   ```bash
   p-cli start explorer 8080
   ```
3. Open the explorer UI via the router (replace the port if different):
   - `http://127.0.0.1:8080/explorer/index.html`
   - MCP requests are proxied at `http://127.0.0.1:8080/mcps/explorer`

## Running Locally (without Ploinky)

This project includes a dedicated test server (`tstServer.mjs`) that simplifies local development.

1.  **Install dependencies:**
    Navigate to the `explorer` directory and install the required npm packages.
    ```bash
    cd explorer
    npm install
    cd ..
    ```

2.  **Start the MCP Filesystem Server:**
    In a terminal, from the root of the `AssistOS` project, run the following command. This server will handle the file operations.
    ```bash
    # Run from the AssistOS project root
    PORT=7101 node explorer/filesystem-http-server.mjs .
    ```
    This configures the server to manage the entire `AssistOS` project directory as its workspace.

3.  **Start the UI & Proxy Server:**
    In a second terminal, also from the root of the `AssistOS` project, start the test server. This will serve the web interface and proxy requests to the MCP server.
    ```bash
    # Run from the AssistOS project root
    node tstServer.mjs
    ```

4.  **Open the Explorer:**
    Open your web browser and navigate to `http://127.0.0.1:8080`. You should now be able to browse the files in your `AssistOS` project.


## MCP Endpoints
All filesystem features are exposed through MCP tools on `/mcp`. Sample calls while the proxy is running:
```bash
curl -s -X POST http://127.0.0.1:8080/mcps/explorer \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "list_directory", "path": "/" }'

curl -s -X POST http://127.0.0.1:8080/mcps/explorer \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "get_file_info", "path": "/package.json" }'
```

## Troubleshooting
- **Port already in use:** stop any process bound to the port (`lsof -ti tcp:8080 | xargs kill`).
- **Permission errors:** ensure the working directory exists and Node has read access.
- **Empty responses:** verify the MCP server is running (check `PORT=7101 node filesystem-http-server.mjs .` log output) and that the proxy points to the same port.
