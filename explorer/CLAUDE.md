# explorer Agent Guide

## Scope

Explorer is the AchillesIDE workspace shell. It owns the routed file browser, preview/editing surfaces, static-agent behavior, runtime plugin hosting, and the dependencies that attach domain agents to the IDE.

## Mandatory Reading Order

1. Read the nearest parent `AGENTS.md` for workspace-wide rules.
2. Read `../docs/index.html` for the local documentation entry point.
3. Read `../docs/specs/matrix.md` and the relevant local DS files before changing behavior.
4. Read `../docs/specs/DS06-ploinky-runtime-invariants.md` before touching auth, routing, guest access, MCP, HTTP services, files, logs, or runtime configuration.
5. Read `../AGENTS.md` for coding style, module structure, and test-organization rules when that file exists; otherwise inherit the parent repository coding-style authority.

## Current Skill Catalog

- No local skill catalog is declared for this agent.

## Repository Rules

- The DS specifications are the source of truth for local contracts and invariants.
- When source code changes behavior, interfaces, architecture, workflows, security boundaries, or runtime configuration, update both the HTML documentation and the DS specifications.
- Keep DS numbering gap-free within any newly initialized GAMP spec set. Preserve existing local numbering conventions unless a migration updates all links in the same change.
- All documentation, specifications, and code comments must be written in English.
- Do not add imported-skill DS files or skill pages to a downstream host project's docs tree.
- Keep Ploinky runtime invariants in local context: router-mediated entry, secure-wire invocation JWTs, scoped guest mode, manifest-declared HTTP services, workspace-confined paths, and redacted logs.
- Never add AI/coding-agent attribution to commits, release notes, changelogs, generated metadata, comments, or documentation.
- Update `AGENTS.md` and `CLAUDE.md` together so coding agents receive the same local context.

## Runtime Defaults

Runs as the static Ploinky agent and enables coupled agents declared by `explorer/manifest.json`.

In the `embedded` profile, Explorer enables Soul Gateway (`proxies/soul-gateway`) as a sibling agent. Explorer and llmAssistant receive the workspace-scoped generated `SOUL_GATEWAY_API_KEY` and resolve the gateway URL through the Ploinky router (`PLOINKY_ROUTER_URL`) only when `PLOINKY_ENV_SOURCE_SOUL_GATEWAY_API_KEY=generated`. If an operator supplies `SOUL_GATEWAY_API_KEY`, Achilles keeps the `LLMConfig.json` Soul Gateway URL unless `SOUL_GATEWAY_BASE_URL` / `SOUL_GATEWAY_URL` explicitly overrides it. The `soul-gateway-settings` IDE plugin provides admin-only provider/model/key management under Settings > Plugins.

## Key Paths

- `manifest.json`
- `../docs/specs/DS06-ploinky-runtime-invariants.md`
- `services/`
- `web-components/`
- `tests/`

## Validation

Run the narrowest relevant check after edits, then broaden when touching shared behavior:

- `npm test`
