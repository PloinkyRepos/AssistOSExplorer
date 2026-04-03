# AchillesIDE

`AchillesIDE` groups the `explorer` IDE shell and the agents that are tightly coupled to it: `dpuAgent`, `gitAgent`, `llmAssistant`, `soplangAgent`, `tasksAgent`, and `multimedia`.

The primary user-facing surface is `explorer`, an MCP-capable IDE shell for filesystem navigation, preview, editing, plugin hosting, and workspace-integrated agent workflows.

The UI is built on the **WebSkel** framework, and all filesystem operations are exposed securely via the Model Context Protocol (MCP).

---

## Key Features

-   **Web-Based File Explorer**: A clean and intuitive UI for browsing and managing files in your workspace.
-   **Repo-Scoped HTML Preview**: HTML preview URLs preserve repo-scoped paths (for example `/.ploinky/repos/AchillesIDE/docs/development.html`) so assets resolve consistently across repos and avoid path collisions.
-   **Extensible Plugin System**: Dynamically load custom plugins to add new features. Plugins can be triggered from the document, chapter, or paragraph level, allowing for highly contextual actions.
-   **Rich Document Handling**: Treats `.md` files not just as text, but as structured documents. This allows for advanced editing, interaction, and data persistence through embedded `soplang` commands.
-   **Blob Storage Service**: A content-addressable storage system for handling file uploads, accessible to other agents in the workspace.
-   **Secure MCP Tools**: Exposes a sandboxed set of filesystem tools (read, write, list, etc.) over MCP for other agents to use.

---

## Full Documentation

For a complete guide to the agent's architecture, plugin development, and advanced features, please see the **[Explorer Agent – Detailed Guide](./docs/index.html)**.

Component-level documentation:

- [explorer](./explorer/README.md)
- [dpuAgent](./dpuAgent/README.md)
- [gitAgent](./gitAgent/README.md)
- [llmAssistant](./llmAssistant/README.md)
- [soplangAgent](./soplangAgent/README.md)
- [tasksAgent](./tasksAgent/README.md)

---

## Running with Ploinky

**Prerequisites:**
- Node.js 20+
- A running Ploinky workspace.

**Steps:**

1.  Enable the repository and the agent in **global** mode from your Ploinky workspace root. This ensures the UI loads assets directly from your checkout.
    ```bash
    ploinky enable repo AchillesIDE
    ploinky enable agent AchillesIDE/explorer global
    ```

2.  Start the workspace. The first run will install dependencies inside the container.
    ```bash
    ploinky start explorer 8080
    ```

3.  Access the Explorer UI via the router (the default port is 8080):
    -   `http://127.0.0.1:8080/explorer/index.html`

4.  Ensure repo-scoped docs preview paths are available in static hosting:
    -   Explorer preview uses repo-scoped paths under `/.ploinky/repos/AchillesIDE/...`.
    -   validate the concrete static path exposed by the current checkout if preview troubleshooting is needed.

---

## MCP Endpoints

All filesystem features are exposed through MCP tools on the `/mcps/explorer/mcp` endpoint.

**Example: List root directory**
```bash
curl -s -X POST http://127.0.0.1:8080/mcps/explorer/mcp \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "list_directory", "path": "/" }'
```
