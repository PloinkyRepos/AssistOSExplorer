# Explorer (AchillesIDE Agent)

This folder contains the `explorer` agent for the Ploinky runtime, inside the `AchillesIDE` repository.

The Explorer is an MCP HTTP server that exposes a filesystem view + utilities used by the AssistOS UI.

For the general text/code editor, Explorer also owns collaborative editing safeguards:

- auto-save is a user setting, default `off`, with a default interval of `10` seconds when enabled
- the editor surface shows when auto-save is on
- if a file changes on disk after an edit session starts, Explorer shows a warning, opens a reload confirmation popup, and blocks save until the file is reloaded

Explorer reserves workspace secret files as non-browsable resources:

- `.secrets`
- any file ending in `.secrets`

These files are blocked from Explorer filesystem MCP access and hidden from the normal Explorer filesystem surface.

## Requirements

- A working Ploinky installation (CLI available as `ploinky`).
- A container runtime supported by Ploinky (Podman or Docker).

## Quick start (recommended)

Run these commands from your workspace root (the folder you want to browse):

```bash
# 1) Add and enable the repo (once per workspace)
ploinky add repo AchillesIDE <repo-url>
ploinky enable repo AchillesIDE

# 2) Ensure Explorer runs in GLOBAL mode (mounts workspace root in container)
ploinky enable agent AchillesIDE/explorer global

# 3) Set the filesystem root Explorer should expose
ploinky var ASSISTOS_FS_ROOT "$PWD"

# 4) Start Explorer as the static agent (also starts Router + dependencies)
ploinky start explorer 8080
```

Open:

- Dashboard: `http://127.0.0.1:8080/dashboard`
- File Explorer UI route: `http://127.0.0.1:8080/#file-exp/`

## Documentation

- [DS01 - Explorer System Overview](../docs/specs/DS01-system-overview.md)
- [DS02 - Plugin Hosting And Dependencies](../docs/specs/DS02-plugin-hosting-and-dependencies.md)
- [DS03 - Confidential Files And DPU](../docs/specs/DS03-confidential-files-and-dpu.md)
- [DS04 - OnlyOffice Integration](../docs/specs/DS04-onlyoffice-integration.md)

## HTML Web Preview Pathing

Explorer Web Preview for `.html` files uses repo-scoped URLs generated from the selected file path:

- Example URL: `/.ploinky/repos/AchillesIDE/docs/development.html?__previewReload=1`
- This avoids collisions between similarly named files in different repos.

## Why GLOBAL mode matters

Ploinky agents can be enabled in different run modes:

- `isolated` (default): only the agent workdir under `./agents/<agent>` is mounted into the container.
- `global`: the workspace root is mounted into the container.

Explorer must run in `global` mode if you want it to browse the whole workspace (including `.ploinky/repos`, `code/`, etc.).

If Explorer is started in `isolated` mode, it can appear as if it "only sees" `agents/` and nothing else.

## Filesystem root (`ASSISTOS_FS_ROOT`)

Explorer uses the `ASSISTOS_FS_ROOT` environment variable to decide what directory to expose.

- Recommended value: your workspace root (the folder you ran `ploinky start` from).
- Example: `ploinky var ASSISTOS_FS_ROOT "$PWD"`

## Troubleshooting

If you only see `agents/` in the Explorer UI:

```bash
ploinky enable agent AchillesIDE/explorer global
ploinky var ASSISTOS_FS_ROOT "$PWD"

# Recreate the explorer container so mounts/env apply
podman rm -f "$(ploinky status | awk '/explorer/ {print $2; exit}')" 2>/dev/null || true
ploinky start explorer 8080
```

If you prefer Docker over Podman, ensure your Ploinky workspace is configured for it.

If HTML preview returns `404` for repo-scoped paths, validate static exposure quickly:

```bash
curl -I "http://127.0.0.1:8080/.ploinky/repos/AchillesIDE/docs/development.html"
```

Expected: `HTTP/1.1 200`.
