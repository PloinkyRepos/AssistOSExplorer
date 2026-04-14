# Explorer

This folder contains the `explorer` agent inside the `AchillesIDE` repository.

Explorer is an HTTP Model Context Protocol (MCP) server plus the main workspace user interface. It owns filesystem browsing, preview, editing, plugin hosting, and the host shell used by the other workspace agents.

## Current Responsibilities

Explorer owns:

- filesystem MCP access within configured workspace roots
- host routing and preview selection
- general text and code editing
- collaborative editing safeguards for local files
- application and document plugin hosting
- session-expiration handling for the browser client

For the general text and code editor, the current collaboration behavior is:

- auto-save is a user setting, default `off`, with a default interval of `10` seconds when enabled
- the editor surface shows when auto-save is enabled
- if a file changes on disk after an edit session starts, Explorer warns the user, opens a reload confirmation popup, and blocks save until the file is reloaded
- if a local file is only being viewed, Explorer polls lightweight file metadata for the current file and reloads the preview automatically if another user updates it
- if the authenticated workspace session expires, Explorer shows a session-expired message and redirects to `/auth/login` with the current route in `returnTo`

Explorer also reserves workspace secret files as non-browsable resources:

- `.secrets`
- any file ending in `.secrets`

These files are blocked from Explorer filesystem MCP access and hidden from the normal Explorer filesystem surface.

## Requirements

- a working Ploinky installation, with `ploinky` available in the shell
- a container runtime supported by Ploinky, such as Podman or Docker

## Running Explorer

Run these commands from the workspace root that Explorer should expose:

```bash
ploinky add repo AchillesIDE <repo-url>
ploinky enable repo AchillesIDE
ploinky enable agent AchillesIDE/explorer global
ploinky var ASSISTOS_FS_ROOT "$PWD"
ploinky start explorer 8080
```

Open:

- dashboard: `http://127.0.0.1:8080/dashboard`
- Explorer route: `http://127.0.0.1:8080/#file-exp/`

## Why Global Mode Is Required

Ploinky agents can run in different modes:

- `isolated`: only the agent workdir is mounted
- `global`: the workspace root is mounted

Explorer must run in `global` mode if it should browse the whole workspace, including `.ploinky/repos` and sibling workspace directories. If Explorer runs in `isolated` mode, it will only see the mounted agent-local subset.

## Filesystem Root

Explorer uses `ASSISTOS_FS_ROOT` to decide what path to expose.

- recommended value: the workspace root
- example: `ploinky var ASSISTOS_FS_ROOT "$PWD"`

## Repo-Scoped HTML Preview

Explorer web preview for `.html` files uses repo-scoped URLs generated from the selected file path.

Example:

- `/.ploinky/repos/AchillesIDE/docs/development.html?__previewReload=1`

This keeps similarly named files from different repositories from colliding under a shared `/docs/...` namespace.

## Documentation

- [DS01 - Explorer System Overview](../docs/specs/DS01-system-overview.md)
- [DS02 - Plugin Hosting and Dependencies](../docs/specs/DS02-plugin-hosting-and-dependencies.md)
- [DS03 - Confidential Files and DPU](../docs/specs/DS03-confidential-files-and-dpu.md)
- [DS04 - OnlyOffice Integration](../docs/specs/DS04-onlyoffice-integration.md)

## Troubleshooting

If Explorer only shows `agents/`, check that it runs in `global` mode and that `ASSISTOS_FS_ROOT` points to the workspace root:

```bash
ploinky enable agent AchillesIDE/explorer global
ploinky var ASSISTOS_FS_ROOT "$PWD"
ploinky start explorer 8080
```

If HTML preview returns `404` for repo-scoped paths, validate static exposure directly:

```bash
curl -I "http://127.0.0.1:8080/.ploinky/repos/AchillesIDE/docs/development.html"
```

Expected result:

- `HTTP/1.1 200`
