# Explorer Startup Plan (Ploinky)

Goal: after the repo is added and enabled, the `@AssistOSExplorer/explorer/` agent must be startable by running:

```sh
ploinky start explorer
```

with all required setup performed via hooks declared in `@AssistOSExplorer/explorer/manifest.json`.

## Current State Analysis

### Explorer agent entrypoint

- Manifest: `AssistOSExplorer/explorer/manifest.json`
  - `agent`: `node /code/filesystem-http-server.mjs`
  - `container`: `node:24.15.0-bullseye`
  - `start`: `sleep infinity`
  - `profiles.default.install`: `apt-get update && apt-get install -y git`
  - `profiles.default.env`: includes `ASSISTOS_FS_ROOT`

### Runtime Node dependencies

- Code: `AssistOSExplorer/explorer/filesystem-http-server.mjs` imports `minimatch`:
  - `import { minimatch } from 'minimatch';`
- Manifest/package: `AssistOSExplorer/explorer/package.json` does not declare `minimatch`.
  - Ploinky global deps (`ploinky/globalDeps/package.json`) also do not include it.
  - Risk: agent crashes with module-not-found at runtime.

### Filesystem root behavior

- `AssistOSExplorer/explorer/utils/server/env-config.mjs`:
  - If `ASSISTOS_FS_ROOT` is not set, roots fall back to `process.cwd()`.
- Under Ploinky, the agent container is started with `-w /code`.
  - Without `ASSISTOS_FS_ROOT`, the Explorer will expose `/code` (agent source) instead of the user workspace.

### Dependency bootstrapping from manifest

- Ploinky applies static agent directives at `ploinky start` time:
  - `manifest.repos{}`: cloned + enabled via `applyManifestDirectives()`.
  - `manifest.enable[]`: enabled via `enableAgent()`.
- Ploinky then starts all enabled agents, dependencies first, static agent last.

### Manifest `start` field impact

- In Ploinky, `manifest.start` triggers “parallel agent” behavior:
  - Container entry runs `manifest.start` (e.g. `sleep infinity`).
  - Real agent command is launched via `docker exec -d ...`.
- This is unnecessary for Explorer and makes lifecycle/health semantics harder to reason about.

## Implementation Plan

### 1) Make runtime dependencies correct

- Update `AssistOSExplorer/explorer/package.json`:
  - Add `minimatch` to `dependencies`.
- Rationale:
  - `filesystem-http-server.mjs` imports it directly.
  - Ploinky’s dependency installer merges `ploinky/globalDeps/package.json` with the agent’s `package.json` and installs to the agent workdir, which is mounted into the runtime container.

### 2) Use normal single-process startup (remove `start: sleep infinity`)

- Update `AssistOSExplorer/explorer/manifest.json`:
  - Remove `start: "sleep infinity"`.
  - Keep `agent: "node /code/filesystem-http-server.mjs"`.
- Expected result:
  - The container’s primary process is the agent itself.
  - Startup failures are surfaced directly and are easier to debug.

### 3) Ensure the default root is the host workspace (not `/code`)

- Add a HOST preinstall hook in `AssistOSExplorer/explorer/manifest.json`:
  - `profiles.default.preinstall`: `scripts/hooks/preinstall.sh` (new)
- Implement `AssistOSExplorer/explorer/scripts/hooks/preinstall.sh` to:
  - If `ASSISTOS_FS_ROOT` is already set, do nothing.
  - Otherwise set it to the current host workspace path via Ploinky secrets:
    - `ploinky var ASSISTOS_FS_ROOT "$PWD"`
- Rationale:
  - Preinstall runs on the host *before* container creation, so `$PWD` resolves to the user workspace.
  - Explorer already declares `ASSISTOS_FS_ROOT` in `profiles.default.env`, so it will be injected into the container once set.

### 4) Keep install hook limited to OS dependencies only

- Keep `profiles.default.install` as OS-only installs:
  - At minimum: `apt-get update && apt-get install -y git`
  - Optionally: add `ca-certificates` if HTTPS/TLS issues occur.
- Do NOT run `npm install` in this hook.
  - Ploinky manages node_modules in the agent workdir; in runtime containers it is typically mounted read-only.

### 5) Make dependency agent references unambiguous

- Review `enable[]` entries in `AssistOSExplorer/explorer/manifest.json`.
- Prefer fully-qualified references where ambiguity is possible:
  - Use `repo/agent global` rather than bare `agent global`.
- Verify that each referenced agent exists in a repo that is cloned/enabled by `repos{}`.

### 6) Add (or extend) a regression test in Ploinky (recommended)

- Add a test that:
  - Runs `ploinky start explorer` in a clean test workspace.
  - Asserts Explorer container is running.
  - Asserts `/health` returns OK.
  - Asserts install/preinstall hooks ran (log markers).

## Verification Steps (Manual)

In a clean workspace:

1. `ploinky add repo AssistOSExplorer <git-url>`
2. `ploinky enable repo AssistOSExplorer`
3. `ploinky start explorer`

Validate:

- `.ploinky/repos/*` contains the repos declared in `repos{}`.
- Agents declared in `enable[]` are enabled and started.
- Explorer responds on its configured port:
  - `GET /health` -> `{ ok: true, server: "secure-filesystem-server" }`
- Explorer exposes the intended filesystem root:
  - `ASSISTOS_FS_ROOT` is set to the host workspace path.
