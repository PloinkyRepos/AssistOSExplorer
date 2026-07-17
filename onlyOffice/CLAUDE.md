# OnlyOffice Agent Guide

## Scope

OnlyOffice owns the runtime boundary for the workspace OnlyOffice Document Server integration. The implementation is a Ploinky-managed agent (`manifest.json`); the previous raw host-managed Document Server container is unsupported by runtime contract v5. Before v5 activation, an operator must explicitly stop and remove that deployment and remove its plaintext state. This agent's preinstall hook only initializes new v5 data directories: it never inspects, imports, stops, deletes, rewrites, or migrates legacy state.

## Mandatory Reading Order

1. Read the nearest parent `AGENTS.md` for workspace-wide rules.
2. Read `docs/index.html` for the local documentation entry point.
3. Read `docs/specs/matrix.md` and `docs/specs/DS01-ploinky-agent-invariant.md` before changing runtime ownership, manifests, hooks, secrets, ports, readiness, storage, or Explorer integration.
4. Read `../docs/specs/DS04-onlyoffice-integration.md` and `../docs/specs/DS06-ploinky-runtime-invariants.md` before changing Explorer-facing Office behavior.

## Repository Rules

- The DS specifications are the source of truth for local contracts and invariants.
- OnlyOffice Document Server is owned by the Ploinky `onlyOffice` agent declared in `manifest.json`.
- OnlyOfficeAgent is the office-session, document/callback, and storage bridge; Explorer is the IDE shell and document picker.
- Keep generated secrets derived through Ploinky runtime contracts and never log JWT secrets, document tokens, callback tokens, or file contents.
- Keep `AGENTS.md` as the canonical pointer stub; substantive local instructions
  belong only in this `CLAUDE.md`.

## Key Paths

- `manifest.json`
- `scripts/hooks/preinstall.sh`
- `docs/specs/DS01-ploinky-agent-invariant.md`
- `../docs/specs/DS04-onlyoffice-integration.md`
- `../docs/specs/DS06-ploinky-runtime-invariants.md`

## Validation

At minimum, validate without printing secrets that the Ploinky agent owns the Document Server container, Explorer and Document Server agree on the JWT secret, `api.js` loads, tokenized document routes work, callbacks work, and Confidential Office files flow through `Explorer -> public Router -> OnlyOffice -> private Router -> dpuAgent`.

- Security e2e (cross-user Confidential denial, internal-route isolation, editor allow-list) live in `tests/e2e/` and are skipped unless run against a live runtime: `ONLYOFFICE_E2E=1 ONLYOFFICE_E2E_ROUTER_BASE_URL=<url> ONLYOFFICE_E2E_AUTH_COOKIE=<cookie> npm test`. Run them in the deployment/CI lane on any routing, proxy, or delegation change. The fast unit test `tests/dpu-store-acl.test.mjs` characterizes the agent-side `contentVisible` ACL reliance without a runtime.
