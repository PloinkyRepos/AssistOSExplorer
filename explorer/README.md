# AssistOS Explorer (Ploinky Agent)

This folder contains the `explorer` agent for the Ploinky runtime.

The Explorer is an MCP HTTP server that exposes a filesystem view + utilities used by the AssistOS UI.

## Requirements

- A working Ploinky installation (CLI available as `ploinky`).
- A container runtime supported by Ploinky (Podman or Docker).

## Quick start (recommended)

Run these commands from your workspace root (the folder you want to browse):

```bash
# 1) Add and enable the repo (once per workspace)
ploinky add repo AssistOSExplorer https://github.com/PloinkyRepos/AssistOSExplorer.git
ploinky enable repo AssistOSExplorer

# 2) Ensure Explorer runs in GLOBAL mode (mounts workspace root in container)
ploinky enable agent AssistOSExplorer/explorer global

# 3) Set the filesystem root Explorer should expose
ploinky var ASSISTOS_FS_ROOT "$PWD"

# 4) Start Explorer as the static agent (also starts Router + dependencies)
ploinky start explorer 8080
```

Open:

- Dashboard: `http://127.0.0.1:8080/dashboard`
- File Explorer UI route: `http://127.0.0.1:8080/#file-exp/`

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
ploinky enable agent AssistOSExplorer/explorer global
ploinky var ASSISTOS_FS_ROOT "$PWD"

# Recreate the explorer container so mounts/env apply
podman rm -f "$(ploinky status | awk '/explorer/ {print $2; exit}')" 2>/dev/null || true
ploinky start explorer 8080
```

If you prefer Docker over Podman, ensure your Ploinky workspace is configured for it.
