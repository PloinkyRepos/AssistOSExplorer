# DS01 - Explorer System Overview

## Summary

`explorer` is the static workspace agent for Ploinky and the default IDE shell for a Ploinky workspace. It exposes the main web UI for filesystem navigation, preview, source editing, document editing, MCP integration, and runtime-mounted application plugins.

## Background / Problem Statement

The workspace needs a single UI host that can:

- browse the workspace filesystem and installed repositories
- integrate specialized MCP agents without moving domain logic into the host
- provide preview, editing, and common actions in one application shell
- run as the static agent served by the Ploinky router

A plain file browser is not sufficient for this role. The workspace needs an IDE-style surface that can:

- navigate code and documents
- preview multiple content classes
- edit local and virtual resources
- host domain-specific tools such as Git, Tasks, DPU, and LLM-assisted flows
- act as the operational front-end for the rest of the workspace

## Goals

1. Serve as the primary workspace UI host
2. Preserve the separation between UI infrastructure and domain logic
3. Integrate dependent agents through MCP and runtime plugins
4. Expose filesystem, preview, and document flows in a coherent way
5. Provide an IDE-like user experience instead of a narrow file-browser experience

## Non-Goals

- implementing Git, DPU, Tasks, SOPLang, or LLM domain logic inside Explorer core
- duplicating the MCP contracts of dependent agents
- full orchestration of external services inside the UI layer
- replacing specialized editors or external services with Explorer-specific forks

## Product Positioning

Explorer should be understood as the workspace IDE, not just as a file explorer.

At product level, Explorer combines:

- repository and filesystem navigation
- code and text editing
- structured document flows
- rich preview flows
- context-sensitive actions
- runtime plugin hosting
- integration points for domain agents

The name `explorer` reflects the historical entry point of the product, but the implemented scope is broader. The UI is the primary operator console for the workspace.

## Architecture Overview

```text
Browser UI
  -> RoutingServer
    -> explorer (static HTTP + MCP)
      -> file-exp page / preview / document UI
      -> runtime plugin loader
      -> explorer services + server routes
        -> dependent MCP agents
```

The architecture is intentionally split between:

- a host shell that owns layout, navigation, preview, and editing infrastructure
- runtime plugins that mount domain UI into defined slots
- dependent MCP agents that own domain mutation logic
- server-side routes that bridge browser interactions to protected or tokenized flows

### Main Layers

| Layer | Responsibility |
|---|---|
| `web-components/` | pages, components, modals, host UI |
| `services/` | front-end logic and runtime integration |
| `utils/server/` | HTTP routes, server-side config, stores, and adapters |
| `filesystem-http-server.mjs` | main agent server |

### Functional Areas

Explorer groups its behavior into a small number of high-level areas:

| Area | Scope |
|---|---|
| navigation shell | path state, list/tree rendering, breadcrumbs, URL sync |
| preview shell | text preview, media preview, document preview, OnlyOffice, DPU secret preview |
| editing shell | code editing, text editing, DPU-backed editing, save and refresh workflows |
| action system | contextual actions, toolbar actions, upload, delete, rename, secret-specific flows |
| plugin system | application plugin discovery, slot mounting, settings-driven enable/disable |
| server integration | HTTP routes, tokenized document flows, OnlyOffice callback flow, MCP bridging |

## Data Models

### Core Navigation State

Explorer maintains state for:

- `path`
- current selection
- `directoryViewMode`
- preview state
- document state
- plugin and runtime state

In practice, this means Explorer coordinates multiple state layers at once:

Explorer also applies a shared interaction language across document, chapter, and paragraph toolbars. Toolbar actions and mounted plugin icons are expected to use a consistent hit area, hover and active feedback, tooltip treatment, and accessibility metadata so that document editing surfaces behave as one IDE rather than as unrelated local widgets.

For document media, Explorer must preserve backward compatibility with both repository-local document media storage (`document-multimedia/<document-context>/...`) and legacy blob-backed attachments (`/blobs/explorer/<id>`). Media consumers must resolve existing document references without requiring manual migration of older documents.

- visible directory context
- selected item identity
- preview mode and preview payload
- editor mode, dirty state, save-pending state, and collaborative file version state
- plugin availability and slot occupancy
- external service session state for flows such as OnlyOffice

For the general text/code editor, Explorer must treat collaboration state as host-owned UI state rather than as widget-local implementation detail. The editor therefore tracks whether auto-save is enabled, the configured idle interval, the current save-in-progress state, and whether the file changed externally after the edit session began. If the on-disk file version changes during an edit session, Explorer must surface a warning in the editor UI, open a reload confirmation modal, and block both manual save and auto-save until the file is reloaded.

When the authenticated workspace session expires, Explorer must not leave the user in a broken in-app state. Session-expiry failures from the filesystem or MCP layer, including MCP HTTP `401 not_authenticated` responses, must surface a simple human session-expired message and then redirect the browser to the login URL supplied by the server, or to `/auth/login` with the current Explorer route preserved in `returnTo` when no explicit login URL is returned.

For a file that is currently open in preview mode, Explorer must also monitor the current on-disk version and automatically refresh the view when another user updates that file. This monitoring must compare lightweight file metadata such as `mtimeMs` and `size`, not poll the full file content. The monitor applies only to the currently viewed local file and must stay separate from the edit-session conflict flow, where automatic reload would be unsafe.

Explorer header chrome inside `file-exp` must also remain collapsible. The `path-info` and `toolbar` rows are host-owned shell chrome, not file content, so the user must be able to hide and restore them without affecting the preview header, preview actions, or document editor state. This preference must persist locally across reloads.

### Resource Classes

Explorer does not operate on a single resource type. It must support:

- normal workspace filesystem entries
- DPU-backed virtual entries
- DPU secrets shown as file-like IDE entries
- document-model resources
- Office session resources routed through OnlyOffice

This is one of the reasons Explorer must be documented as an IDE shell rather than a simple file list UI.

### Dependency Model

Dependencies declared in [manifest.json](../../explorer/manifest.json) include:

- `gitAgent`
- `dpuAgent`
- `soplangAgent`
- `tasksAgent`
- `llmAssistant`
- supporting services such as `postgres` and `keycloak`

Explorer depends on these agents asymmetrically:

- Explorer owns the host UI and navigation model
- dependent agents own domain operations, permissions, and domain-specific UI slices
- the router exposes Explorer as the user-facing application
- runtime plugins convert agent capabilities into IDE affordances

## Primary User Flows

The most important Explorer flows are:

1. browse a workspace path in list or tree mode
2. open a file, document, or virtual resource
3. preview or edit the selected resource
4. invoke context-sensitive actions
5. hand off domain-specific workflows to mounted plugins or MCP agents
6. keep URL, breadcrumb, selection, and preview state synchronized

These flows define Explorer's IDE behavior more accurately than a generic “open folder and inspect files” model.

## API Contracts

### Static UI Contract

Explorer serves the main web application and static resources for the router.

### MCP / HTTP Integration Contract

Explorer consumes dependent agents through:

- MCP routes proxied by Ploinky
- its own HTTP routes for sessions, preview, and document flows

For filesystem MCP tools, Explorer must enforce a reserved-file boundary for workspace secret files:

- `.secrets`
- any file ending in `.secrets`

These files are not valid Explorer filesystem resources. They must not be returned by filesystem listing, directory tree, or search operations, and direct filesystem read access to them must be denied.

Explorer also acts as an HTTP boundary for flows where the browser cannot talk directly to the underlying domain model. Important examples are:

- OnlyOffice session creation
- tokenized public document routes
- callback ingestion for document save flows
- protected server-side configuration and session derivation

### Plugin Contract

Runtime plugins are discovered from enabled agent-owned `IDE-plugins/` directories in the workspace. Explorer then applies `applicationPlugins` from the manifest as an allow/deny policy for application-category plugins before mounting them into slots such as `file-exp:toolbar`.

Plugin integration is runtime-driven rather than compile-time hardcoded. Explorer therefore has to preserve:

- stable slot names
- deterministic plugin ordering
- stable mount behavior across enable and disable flows
- clear ownership boundaries between host and plugin

## Behavioral Specification

### Startup

1. Ploinky applies Explorer manifest directives and starts the declared dependencies in parallel
2. Explorer starts as the static agent
3. Ploinky waits for readiness of every dependency declared in `manifest.enable[]`, plus Explorer itself
4. The router publishes the Explorer application
5. The runtime plugin loader activates the enabled plugins

Explorer startup is correct only when the user-facing application can safely rely on all enabled dependent agents, not only on Explorer's own port or MCP handshake.

### Navigation

Explorer manages:

- list view and tree view
- breadcrumb and URL synchronization
- preview and editing
- mount points for domain-specific components

Navigation is not limited to local filesystem traversal. It also covers:

- virtual DPU roots
- plugin-driven route state
- preview-specific transitions
- transitions between selection, preview, and edit mode

For local workspace navigation, Explorer must also suppress reserved secret files from visible filesystem navigation. `.secrets` and `*.secrets` are hidden from the normal file explorer surface even when they physically exist in the mounted workspace.

### Editing

Explorer supports multiple editing classes:

- plain text and code editing
- document editing
- DPU-backed file editing
- DPU secret value editing
- Office editing delegated to OnlyOffice

The editing model must always preserve the current source of truth for the selected resource. For DPU-backed resources this includes refresh-before-edit and concurrency-sensitive save flows.

### Preview

Explorer preview behavior is content-aware. The preview shell may render:

- syntax-like text preview
- custom DPU secret preview
- image, audio, or video preview
- document preview
- OnlyOffice editor host

Preview is therefore part of the IDE surface, not an auxiliary convenience feature.

## Configuration

### Required / Relevant Environment

- `ASSISTOS_FS_ROOT`
- `ONLYOFFICE_PUBLIC_URL`
- `ONLYOFFICE_INTERNAL_URL`
- `ONLYOFFICE_JWT_SECRET`
- `ONLYOFFICE_CALLBACK_BASE_URL`
- `SOUL_GATEWAY_API_KEY`

Depending on the enabled integrations, additional environment may be required indirectly by dependent agents or by infrastructure such as authentication and database services.

## Design Constraints

Explorer must preserve the following constraints:

- host UI logic stays in Explorer
- domain mutation logic stays in dependent agents
- virtual resources must not be mistaken for normal filesystem entries at the persistence layer
- browser-visible flows and server-side secure flows must remain separated
- plugin enablement must not reorder the host unpredictably
- documentation must track product behavior as Explorer grows from file browser into IDE shell

## Related Specs

- [DS02 - Plugin Hosting And Dependencies](./DS02-plugin-hosting-and-dependencies.md)
- [DS03 - Confidential Files And DPU](./DS03-confidential-files-and-dpu.md)
- [DS04 - OnlyOffice Integration](./DS04-onlyoffice-integration.md)
