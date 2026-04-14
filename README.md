# AchillesIDE

`AchillesIDE` groups the `explorer` IDE shell and the agents that are coupled to it: `dpuAgent`, `gitAgent`, `llmAssistant`, `soplangAgent`, `tasksAgent`, and `multimedia`.

Explorer is the main user-facing surface. It exposes filesystem navigation, preview, editing, plugin hosting, and workspace-integrated agent workflows through the WebSkel frontend and the Explorer Model Context Protocol (MCP) backend.

## Repository Scope

This repository is organized around one host shell and several agent boundaries:

- `explorer` owns routing, filesystem access, preview, editing, and plugin hosting
- `dpuAgent` owns confidential data and secret storage
- `gitAgent` owns workspace Git operations
- `llmAssistant` owns shared LLM-backed helper contracts
- `soplangAgent` owns SOPLang build and execution orchestration
- `tasksAgent` owns backlog file operations
- `multimedia` owns media-oriented IDE plugin workflows

## Running Explorer

Prerequisites:

- Node.js 20+
- a running Ploinky workspace

From the workspace root:

```bash
ploinky enable repo AchillesIDE
ploinky enable agent AchillesIDE/explorer global
ploinky start explorer 8080
```

Open:

- `http://127.0.0.1:8080/explorer/index.html`

If Explorer should expose the whole workspace, set the filesystem root explicitly:

```bash
ploinky var ASSISTOS_FS_ROOT "$PWD"
```

## Documentation

Repository-level documentation:

- [Explorer Detailed Guide](./docs/index.html)
- [explorer](./explorer/README.md)
- [dpuAgent](./dpuAgent/README.md)
- [gitAgent](./gitAgent/README.md)
- [llmAssistant](./llmAssistant/README.md)
- [soplangAgent](./soplangAgent/README.md)
- [tasksAgent](./tasksAgent/README.md)

The `multimedia` agent currently documents itself through [multimedia/docs/index.html](./multimedia/docs/index.html).

## Explorer MCP Endpoint

Explorer filesystem features are exposed through the Explorer Model Context Protocol endpoint:

- `/mcps/explorer/mcp`

Example:

```bash
curl -s -X POST http://127.0.0.1:8080/mcps/explorer/mcp \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "list_directory", "path": "/" }'
```
