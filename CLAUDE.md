# AchillesIDE / Ploinky Explorer

Ploinky Explorer workspace + 17 coupled agents. Origin: `https://github.com/PloinkyRepos/AssistOSExplorer.git`.

## Mandatory reading order

1. Parent `~/work/file-parser/CLAUDE.md` for workspace conventions.
2. The agent's local `CLAUDE.md` you're editing (under each subdir).
3. The agent's `docs/specs/matrix.md` + `DS*-ploinky-runtime-invariants.md` for auth/MCP/HTTP/runtime changes.
4. `docs/specs/DS06-ploinky-runtime-invariants.md` at repo root for cross-cutting routing/auth/plugin-hosting.
5. Relevant Ploinky specs in `../ploinky/docs/specs/` (esp. `DS005-routing-and-web-surfaces.md`, `DS011-security-model.md`) when touching router/secure-wire/guest sessions.

## Project structure

- `explorer/` — routing, FS access, preview, editing, plugin hosting, Explorer MCP.
- `dpuAgent/` — confidential data, secret storage, ACL behavior.
- `gitAgent/` — workspace Git operations, MCP tooling, auth integration.
- `llmAssistant/` — shared LLM-backed helper contracts.
- `soplangAgent/` — SOPLang build and execution orchestration.
- `tasksAgent/` — backlog file operations.
- `multimedia/`, `webmeetAgent/`, `webmeetLivekitAiAgent/`, `webmeetInfra/`, `webassist/` — domain-specific workflows.
- `AchillesCLI/` — Achilles skill management CLI. See `AchillesCLI/CLAUDE.md` and `AchillesCLI/docs/specs/` for local architecture and runtime contracts.
- `shared/` — shared runtime utilities.
- `docs/` and each agent's `docs/specs/` — user docs and DS specs.

## Coding conventions

- Node.js 20+, ES modules (`import`/`export`), `.mjs` where established, `async`/`await`.
- 4-space JS indent, 2-space JSON/YAML, trailing commas for multi-line.
- camelCase filenames, files beside related logic.
- Prefer native Node features; minimize deps. Use structured APIs over ad-hoc string parsing.
- Resolve paths from `agentRoot`, configured data dir, or active workspace root — never hardcode absolute host paths.
- Long-lived state is durable outside process memory; Ploinky restarts agents at any time.

## Ploinky / Achilles runtime

- Agents run as isolated (usually containerized) Ploinky processes. Entry point: `src/index.mjs`. Receives prompts, returns text or JSON.
- Tool/internal logs are NOT visitor-facing. Final answers are clean conversational text unless an endpoint expects JSON.
- All agents are built on `achillesAgentLib` at `/Users/danielsava/work/file-parser/ploinky/node_modules/achillesAgentLib`. See its `CLAUDE.md` for the subsystem map.
- Request-time LLM access must go through Achilles runtime helpers, not ad-hoc vendor HTTP, unless a local spec defines an exception.
- Soul Gateway runs as a sibling Ploinky agent providing LLM routing for Explorer and llmAssistant. Gateway consumers receive a workspace-scoped generated `SOUL_GATEWAY_API_KEY` and resolve the gateway URL through the Ploinky router. If Explorer deployment needs `soul.axiologic.dev`, configure it as the local gateway's normal `soul-gateway` provider with `SOUL_GATEWAY_PROVIDER_API_KEY` or an operator `SOUL_GATEWAY_API_KEY` that the Soul Gateway manifest maps into that provider key; do not replace the generated local gateway key with a production API key. See `proxies/soul-gateway/docs/specs/DS016-ploinky-agent-mode.md` for the unified contract.

## Skills contract

- Explicit input/output, no hidden side effects.
- Read-only ops don't mutate files or session state.
- Write ops have explicit payload shape (`content`, target ids, mode flags).
- One semantic action per tool call.

## Logging

- Detailed internals/stack/payloads only in `ACHILLES_DEBUG=true`. Default mode surfaces generic, safe failures.
- Never leak secrets, tokens, system prompts, or hidden decision traces to end users.
- Language stays aligned with user language unless contract requires otherwise.

## Testing

- Run the narrowest meaningful tests first, then broaden.
- `explorer/`: `npm test` — `dpuAgent/`: `npm test` — `soplangAgent/`: `npm test` — `gitAgent/`: `node --test gitAgent/tests/unit/*.test.mjs`.
- For startup/restart/routing/container lifecycle changes, also run the relevant Ploinky workflow or smoke path.
- For cross-agent browser regressions, follow `docs/regression/headless-browser-regression.md`. Keep browser traces, OAuth state, generated workspaces, media captures, regression artifacts out of tracked source — use `.ploinky/test-artifacts/...`.

## Deploy and remote ops

Public URL: `https://skills.axiologic.dev`. SSH: `admin@193.180.209.191` (key `~/demo_private_key.pem`), workspace `~/explorerWorkspace`, router port `8097`. Override via GitHub Actions vars `SSH_USER`/`SSH_HOST`/`EXPLORER_WORKSPACE`/`EXPLORER_ROUTER_PORT`.

- **Canonical production deploy/recovery:** `.github/workflows/deploy-skills-explorer.yml` (passes `PLOINKY_MASTER_KEY` through stop→update→start).
- **Explorer QA on the Soul/proxies host:** `.github/workflows/deploy-explorer-qa.yml` targets `admin@45.136.70.141` with QA workspace `~/explorerQaWorkspace` and router port `8097`. It is **co-located with production Soul Gateway** (`~/soulGateway`, port `8080`), so it uses only `EXPLORER_QA_*` GitHub config and enforces one invariant: no QA operation acts on a port/workspace/runtime it does not own. It skips `ploinky shutdown` unless the QA `routing.json` owns `8097`, never mutates the shared Ploinky/`achillesAgentLib` runtime (asserts the branch instead), and pre/post-checks Soul Gateway health on `8080`. Starting Explorer brings its full agent stack (WebMeet/LiveKit/OnlyOffice); infra health gates are non-fatal unless `EXPLORER_QA_STRICT_INFRA_CHECKS=1`.
- **Do not** use `.github/workflows/update-explorer.yml` to restart production unless it's confirmed to pass `PLOINKY_MASTER_KEY` for any command that reads encrypted secrets or runs preinstall hooks.
- `.ploinky/.secrets` is encrypted. Never append/edit as plaintext; use `ploinky var` with `PLOINKY_MASTER_KEY` set.
- Other workflows: `provision-skills-explorer-host.yml`, `remote-skills-status.yml`, `update-explorer.yml`, `destroy-explorer.yml`. Use the narrower workflow only when its secret requirements match the operation. After any deploy/restart, verify local router health, public `/dashboard`, container status, Ploinky status, and start logs.

## Documentation rules

- All technical docs, specs, and code comments in English.
- Specification-driven development. Agent specs live under `docs/specs/` as `DS0XX-short-description.md`.
- DS specs are the source of truth for contracts and invariants. `docs/specs/DS06-ploinky-runtime-invariants.md` is the root local copy of runtime/security invariants.
- Code changes that affect agent behavior update the relevant HTML docs and DS specs in the same change.

## Commit/PR rules

- Inherits root workspace commit policy (no AI attribution). See `~/work/file-parser/CLAUDE.md`.
- **Active feature branch (TEMPORARY, set 2026-06-16):** Only commit on `soul-gateway-local-integration`; never on `main`/`master`. Holds until the user lifts it — see root `CLAUDE.md`.
- Commits in present-tense imperative ("Add smoke harness helpers"). Group unrelated changes into separate commits.
- PRs link issues, outline behavior impact, include repro steps or test output when touching runtime flows.
- Add screenshots/captures for dashboard, Explorer UI, or CLI changes.
