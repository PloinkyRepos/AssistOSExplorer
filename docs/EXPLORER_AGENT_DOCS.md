# Explorer Agent – Comprehensive Guide

This guide consolidates all Explorer documentation (architecture, document model, plugins, MCP tools, SOPLang integration, build pipeline, and development setup) in one place.

---

## 1) What Explorer Is

- **Containerized UI + FS MCP server**: Runs `filesystem-http-server.mjs` (Node 20-alpine) serving the <a href="https://github.com/OutfinityResearch/WebSkel/blob/master/README.md">WebSkel UI</a> and filesystem MCP tools. Allowed roots come from `ASSISTOS_FS_ROOT`/`MCP_FS_ROOT` or CLI args.
- **Plugin host**: Discovers `IDE-plugins/*/config.json` from enabled agents and repo-local agent folders in the workspace; tools are exposed to the UI grouped by `location`, then filtered by Explorer's `applicationPlugins` policy.
- **Document manager**: Markdown is parsed into chapters/paragraphs with metadata and SOPLang commands.
- **No HTTP blob endpoint in current server**: UI helpers expect `/blobs/<agent>`, but `filesystem-http-server.mjs` only exposes MCP on `/mcp` and a `/health` check.
- **Plugin sources**: Runtime plugins are distributed across agent-owned `IDE-plugins/` directories such as `dpuAgent/IDE-plugins`, `gitAgent/IDE-plugins`, `multimedia/IDE-plugins`, `soplangAgent/IDE-plugins`, and `tasksAgent/IDE-plugins`.
- **Separate SOPLang agent**: `soplangAgent` (repo `SOPLangBuilder`) provides explicit MCP tools such as `sync_markdown_documents` and `execute_workspace_build`; it runs in its own container sharing the workspace.

---

## 2) Runtime & Routing

- **Manifest**: `explorer/manifest.json` defines the Explorer runtime container, startup command, environment, and external dependency agents.
- **Global mode**: `ploinky enable agent AchillesIDE/explorer global` runs in the current workspace folder. First `ploinky start explorer <port>` also pins the router/static port.
- **Startup readiness**: `ploinky start explorer` starts the enabled dependency agents in parallel and waits for readiness of every dependency declared in Explorer `manifest.json -> enable[]`, plus Explorer itself, before reporting the workspace ready.
- **Router**: <a href="https://github.com/OutfinityResearch/ploinky/blob/master/README.md">Ploinky</a> router serves static UI and proxies MCP on the chosen port (e.g., dashboard on `/dashboard`, main Explorer UI on `/#file-exp/`).
- **Repo-scoped static exposure for docs preview**: HTML preview uses repo-scoped paths under `/.ploinky/repos/AchillesIDE/docs/*`.
- **Allowed directories**: Derived from `ASSISTOS_FS_ROOT`/`MCP_FS_ROOT` (comma-separated). If missing, falls back to `process.cwd()`. Multiple roots → first is workspace root.
- **Containers & workspace**: Explorer and soplangAgent containers mount the same host workspace volume; each has its own MCP endpoints.

---

## 3) Architecture (textual)

- **Browser (<a href="https://github.com/OutfinityResearch/WebSkel/blob/master/README.md">WebSkel UI</a>)** → **<a href="https://github.com/OutfinityResearch/ploinky/blob/master/README.md">Ploinky</a> Router** (static/proxy) → **Explorer container** (MCP filesystem tools) → **Workspace FS (allowed roots)**.
- **MCP clients** (UI/other agents) call Explorer MCP directly for filesystem tools.
- **soplangAgent container** (node:20-alpine) receives MCP calls separately; it reads files directly from the mounted workspace.
- Both containers run independently; there is no hop Explorer → soplangAgent.

---

## 4) Document Model & Editing

- **View/Edit modes**: Any file can be opened; Markdown gets structured document features, other text/code files use the general editor (with syntax highlighting, no document DOM).
- **HTML Web Preview URL model**: Preview preserves repo-scoped paths generated from selected file path (e.g., `/.ploinky/repos/AchillesIDE/docs/development.html?__previewReload=1`) instead of flattening to root-level `/docs/*`.
- **Hydration**: `DocumentStore.hydrateDocumentModel` parses Markdown plus comment markers into a hierarchy (document → chapters → paragraphs).
  - Example comment markers:
    - `<!--{"achilles-ide-document": {"id": "guide", "title": "My Guide"}}-->`
    - `<!--{"achilles-ide-chapter": {"title": "Intro"}}-->`
    - `<!--{"achilles-ide-paragraph": {"text": "Hello", "commands": "@media_image_123 attach id \"blob-id\" name \"hero.png\""}}-->`
- **Persistence via SOPLang commands**: Commands are embedded inline and preserved on save.
  - Example: `@media_image_123 attach id "blob-id" name "hero.png"` stays in the Markdown; UI renders the image using parsed data.
- **Document info**: Title and Info Text are stored in metadata (e.g., Title “Release Notes”, Info “Changelog for v1.2”).
- **Table of Contents**: Built from chapters; selecting an entry scrolls to that chapter.
- **Comments**: Stored per document/chapter/paragraph (e.g., “Clarify API version” attached to a paragraph).
- **References**: Stored in `references` array (e.g., title “RFC 9110”, URL set in references table).
- **Snapshots/Tasks/Variables**: Version snapshots, to-dos, and variables (e.g., `releaseVersion=1.2.0`) are part of the model; dialogs manage them.
- **Other files**: Open `config/app.json` or `src/main.js` with the general editor; no chapter/paragraph structure, only text + syntax highlight.

---

## 5) SOPLang Usage in Documents

- **Embed code**: Use fenced ` ```soplang ` blocks for scripts.
- **Achilles comments**: `achilles-ide-document/chapter/paragraph` markers map Markdown to the model and keep commands in sync.
- **Variables & media**: Commands like `@set doc_owner "alice@company.com"` or `@media_image_123 attach id "abcd" name "diagram.png"` live in the Markdown and are parsed on hydration.
- **Execution**: UI actions can run SOPLang blocks via soplangAgent; outputs/variable updates flow back into the model. Reload to re-hydrate after edits.
- **Flow fit**: Documents + SOPLang commands define structure; the build pipeline (below) persists them via soplangAgent.

---

## 6) Plugin System

- **Discovery**: MCP tool `collect_ide_plugins` calls `aggregateIdePlugins`, scanning enabled agent/plugin folders in the workspace for `IDE-plugins/*/config.json` on each invocation (e.g., UI load). Results are grouped by `location`, then the browser applies `applicationPlugins` policy from `explorer/manifest.json`.
- **Manifest example**:
  ```json
  {
    "component": "video-creator",
    "presenter": "VideoCreator",
    "type": "modal",
    "location": ["document"],
    "tooltip": "Create a video from a script",
    "icon": "./assets/icons/video.svg"
  }
  ```
- **Example plugin (Uppercase paragraph)**: Folder `IDE-plugins/uppercase/` with `config.json`, `uppercase-plugin.html`, and presenter implementing `beforeRender/afterRender`, calling `documentModule.updateParagraphText` then showing a toast and closing the modal.
- **UI-only scaffold**: Plugins can be simple UI bundles with `manifest.json` and static assets (see “Plugins guide” in the site for full steps).

---

## 7) Backend: MCP + SOPLang

- **MCP (Explorer):** Serves filesystem tools over `/mcp` (plus `/health`), enforcing `allowedDirectories` from `ASSISTOS_FS_ROOT`/`MCP_FS_ROOT`. Path args are resolved/normalized; anything outside whitelisted roots is rejected. No `/blobs` HTTP endpoint.
- **MCP capabilities (by function):** Read text/media/small batches; write/edit text or binary; list/tree directories (simple/detailed/sized); move/copy/delete; metadata/info and search; list allowed directories; aggregate `IDE-plugins/*/config.json` for the UI.
- **SOPLang (soplangAgent):** Separate container with explicit MCP tools such as `sync_markdown_documents`, `execute_workspace_build`, `build_from_specs_markdown`, `get_variables_with_values`, and `execute_skill`. Runs SOPLang scripts, manages variables, and hosts plugins such as `SoplangBuilder`. Commands and variables are embedded in Markdown comments/blocks and preserved on save.
- **Variables & commands:** `@set releaseVersion "1.4.0"`, `@media_image_hero attach id "blob-id" name "hero.png"`. Variables live in the document model; media commands store blob IDs only.
- **SOPLang build (Markdown → Documents):** `SoplangBuilder.syncMarkdownDocuments` scans `.md` files, reads `achilles-ide-document/chapter/paragraph` comments, applies templates to the document store, then `workspace.forceSave()` persists the synchronized state. `SoplangBuilder.executeWorkspaceBuild` runs `workspace.buildAll()` separately for expensive or long-running skill execution. Invoke via MCP with `sync_markdown_documents` and `execute_workspace_build`; logs at `SOPLangBuilder/last-tool.log`.

---

## 8) Development & Setup

- **Prereqs**: Node 20+, npm, active <a href="https://github.com/OutfinityResearch/ploinky/blob/master/README.md">Ploinky</a> workspace.
- **Global run**: `ploinky enable repo AchillesIDE` then `ploinky enable agent AchillesIDE/explorer global`; start with `ploinky start explorer 8080` (router/UI on that port, dashboard on `/dashboard`, main file UI on `/#file-exp/`).
- **Filesystem root**: Set `ASSISTOS_FS_ROOT` (or `MCP_FS_ROOT`) to the workspace path(s); fallback is cwd. First root is workspace root.
- **Bundled local plugins**: Explorer-facing plugins are loaded from the enabled agents' `IDE-plugins/` directories in this repository.
- **Dependencies**: `npm install` at repo root (and `explorer/` if needed).
- **Hot reload**: UI refresh picks up most changes; plugin `config.json` or new plugins require Explorer restart to rescan. SOPLang comment edits are re-hydrated on reload; rerun `syncMarkdownDocuments` to persist into the SOPLang store.
- **Preview portability rule**: use the repo-scoped static path exposed by the current repository layout. Do not document symlinks that are not present in the checkout.
- **Repo layout (Explorer)**:
  ```
  explorer/
  ├─ filesystem-http-server.mjs   # MCP, plugin discovery
  ├─ index.html / main.js         # SPA entry
  ├─ webskel.json                 # UI components
  ├─ web-components/              # UI implementations
  ├─ services/                    # Document parsing/services
  └─ utils/                       # Shared utilities
  ```

  Additional plugin bundles currently live under sibling agent folders such as `dpuAgent/IDE-plugins`, `gitAgent/IDE-plugins`, `multimedia/IDE-plugins`, `soplangAgent/IDE-plugins`, and `tasksAgent/IDE-plugins`.

---

## 9) SOPLang Agent (overview)

- **Manifest**: `soplangAgent/manifest.json` – `container: node:20-alpine`, `postinstall: apk add ffmpeg`.
- **MCP tools**: explicit entries in `soplangAgent/mcp-config.json`, including `sync_markdown_documents`, `execute_workspace_build`, `build_from_specs_markdown`, `get_variables_with_values`, and `execute_skill`.
- **Plugins loaded**: SOPLang core plugins plus `plugins/SoplangBuilder.js` if present; log captured in `last-tool.log`.
- **Workspace access**: Reads markdown directly from mounted workspace; not dependent on Explorer backend.

---

## 10) General Notes

- Blob uploads: UI utilities target `/blobs/<agent>`, but the current Explorer server does not implement this HTTP endpoint. Plan workflows accordingly (or add server support if needed).
- MCP isolation: Call Explorer and soplangAgent independently; do not route SOPLang MCP calls through Explorer.
- View vs. edit: All files support both; structured features apply only to Markdown. Syntax highlighting is presentation only for code/text files.
