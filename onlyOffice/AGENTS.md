# OnlyOffice Agent Guide

## Scope

OnlyOffice owns the target runtime boundary for the workspace OnlyOffice Document Server integration. The implementation must become a Ploinky-managed agent; until that migration is complete, any raw host-managed Document Server container is a temporary compatibility shim only.

## Mandatory Reading Order

1. Read the nearest parent `AGENTS.md` for workspace-wide rules.
2. Read `docs/index.html` for the local documentation entry point.
3. Read `docs/specs/matrix.md` and `docs/specs/DS01-ploinky-agent-invariant.md` before changing runtime ownership, manifests, hooks, secrets, ports, readiness, storage, or Explorer integration.
4. Read `../docs/specs/DS04-onlyoffice-integration.md` and `../docs/specs/DS06-ploinky-runtime-invariants.md` before changing Explorer-facing Office behavior.

## Repository Rules

- The DS specifications are the source of truth for local contracts and invariants.
- OnlyOffice Document Server must be owned by a Ploinky agent in the target architecture.
- Explorer remains the office-session and storage bridge; it must not own the Document Server lifecycle after migration.
- Keep generated secrets derived through Ploinky runtime contracts and never log JWT secrets, document tokens, callback tokens, or file contents.
- Update `AGENTS.md` and `CLAUDE.md` together so coding agents receive the same local context.

## Validation

At minimum, validate without printing secrets that the Ploinky agent owns the Document Server container, Explorer and Document Server agree on the JWT secret, `api.js` loads, tokenized document routes work, callbacks work, and Confidential Office files still flow through `Explorer -> Ploinky router -> dpuAgent`.
