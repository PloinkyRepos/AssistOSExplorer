<!-- {"achilles-ide-document":{"id":"Ly5wbG9pbmt5L3JlcG9zL2ZpbGVFeHBsb3Jlci9SRUFETUUubWQ=","title":"README","version":1,"updatedAt":"2026-04-29T15:36:48.430Z"}} -->
<!-- {"achilles-ide-chapter":{"id":"chapter-2b41c910-2fc9-438c-a615-dac2bc563f42","title":"AchillesIDE","anchorId":"chapter-chapter-2b41c910-2fc9-438c-a615-dac2bc563f42"}} -->
<a id="chapter-chapter-2b41c910-2fc9-438c-a615-dac2bc563f42"></a>
# AchillesIDE
<!-- {"achilles-ide-paragraph":{"id":"paragraph-070de524-21ad-4600-9211-3bca9d2f5791","type":"markdown","title":"Paragraph 1"}} -->
`AchillesIDE` groups the `explorer` IDE shell and the agents that are coupled to it: `dpuAgent`, `gitAgent`, `llmAssistant`, `soplangAgent`, `tasksAgent`, and `multimedia`.

Explorer is the main user-facing surface. It exposes filesystem navigation, preview, editing, plugin hosting, and workspace-integrated agent workflows through the WebSkel frontend and the Explorer Model Context Protocol (MCP) backend.


<!-- {"achilles-ide-chapter":{"id":"chapter-55ee0622-aa0f-4269-b425-d13d9292f518","title":"Repository Scope","anchorId":"chapter-chapter-55ee0622-aa0f-4269-b425-d13d9292f518"}} -->
<a id="chapter-chapter-55ee0622-aa0f-4269-b425-d13d9292f518"></a>
## Repository Scope
<!-- {"achilles-ide-paragraph":{"id":"paragraph-c7ca7ebb-3c7a-4003-bed3-e438ed6d8d03","type":"markdown","title":"Paragraph 1"}} -->
This repository is organized around one host shell and several agent boundaries:

- `explorer` owns routing, filesystem access, preview, editing, and plugin hosting
- `dpuAgent` owns confidential data and secret storage
- `gitAgent` owns workspace Git operations
- `llmAssistant` owns shared LLM-backed helper contracts
- `soplangAgent` owns SOPLang build and execution orchestration
- `tasksAgent` owns backlog file operations
- `multimedia` owns media-oriented IDE plugin workflows 


<!-- {"achilles-ide-chapter":{"id":"chapter-e807b655-0b94-43fc-9204-72c66a6083a1","title":"Running Explorer","anchorId":"chapter-chapter-e807b655-0b94-43fc-9204-72c66a6083a1"}} -->
<a id="chapter-chapter-e807b655-0b94-43fc-9204-72c66a6083a1"></a>
## Running Explorer
<!-- {"achilles-ide-paragraph":{"id":"paragraph-43718983-82ec-4d1f-b6bb-73124d74afb8","type":"markdown","title":"Paragraph 1"}} -->
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


<!-- {"achilles-ide-chapter":{"id":"chapter-b0a9377d-0621-4ae6-a64e-8c2fa5648cbf","title":"Repo-Scoped HTML Preview","anchorId":"chapter-chapter-b0a9377d-0621-4ae6-a64e-8c2fa5648cbf"}} -->
<a id="chapter-chapter-b0a9377d-0621-4ae6-a64e-8c2fa5648cbf"></a>
## Repo-Scoped HTML Preview
<!-- {"achilles-ide-paragraph":{"id":"paragraph-b8760027-85e8-4520-abc6-013a886d7abf","type":"markdown","title":"Paragraph 1"}} -->
Explorer serves repository files below the Ploinky repository mount. For example:

- `/.ploinky/repos/AchillesIDE/docs/development.html`

```bash
curl -I "http://127.0.0.1:8080/.ploinky/repos/AchillesIDE/docs/development.html"
```


<!-- {"achilles-ide-chapter":{"id":"chapter-90a7ac8d-d14c-43a6-8d12-8b0569ddd1a4","title":"Documentation","anchorId":"chapter-chapter-90a7ac8d-d14c-43a6-8d12-8b0569ddd1a4"}} -->
<a id="chapter-chapter-90a7ac8d-d14c-43a6-8d12-8b0569ddd1a4"></a>
## Documentation
<!-- {"achilles-ide-paragraph":{"id":"paragraph-63dc0f23-9c27-437e-81c2-b3406c7569f6","type":"markdown","title":"Paragraph 1"}} -->
Repository-level documentation:

- [Explorer Detailed Guide](./docs/index.html)
- [explorer](./explorer/README.md)
- [dpuAgent](./dpuAgent/README.md)
- [gitAgent](./gitAgent/README.md)
- [llmAssistant](./llmAssistant/README.md)
- [soplangAgent](./soplangAgent/README.md)
- [tasksAgent](./tasksAgent/README.md)

The `multimedia` agent currently documents itself through [multimedia/docs/index.html](./multimedia/docs/index.html).


<!-- {"achilles-ide-chapter":{"id":"chapter-67422a50-bb51-4b6d-aec7-944070b89d82","title":"Explorer MCP Endpoint","anchorId":"chapter-chapter-67422a50-bb51-4b6d-aec7-944070b89d82"}} -->
<a id="chapter-chapter-67422a50-bb51-4b6d-aec7-944070b89d82"></a>
## Explorer MCP Endpoint
<!-- {"achilles-ide-paragraph":{"id":"paragraph-505eebf5-ce31-4320-99b7-d6d4c4286935","type":"markdown","title":"Paragraph 1"}} -->
Explorer filesystem features are exposed through the Explorer Model Context Protocol endpoint:

- `/mcps/explorer/mcp`

Example:

```bash
curl -s -X POST http://127.0.0.1:8080/mcps/explorer/mcp \
  -H 'Content-Type: application/json' \
  -d '{ "tool": "list_directory", "path": "/" }'
```

