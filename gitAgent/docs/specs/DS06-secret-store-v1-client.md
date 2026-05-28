# DS06 — DPU-aware secret-store client

Status: implemented (2026-04-20)

## Summary

`gitAgent` is explicitly coupled to `dpuAgent`. It uses the client at
`lib/secret-store-client.mjs` to call DPU through the router over a single
delegated JSON-RPC `tools/call` per operation. No capability binding lookup
and no MCP session setup.

## Client behavior

`lib/secret-store-client.mjs`:

- resolves the DPU route name from `PLOINKY_DPU_ROUTE`, defaulting to
  `dpuAgent`
- extracts the current router-issued invocation JWT from `authInfo.invocationToken`
- forwards that JWT to the router in `X-Ploinky-Caller-JWT`
- never mints or signs caller assertions and does not read agent private-key
  material
- POSTs a single JSON-RPC `tools/call` request to
  `{router}/{dpuRoute}/mcp`
- calls only the canonical DPU domain operations
  (`dpu_secret_get`, `dpu_secret_put`, `dpu_secret_delete`,
  `dpu_secret_grant`, `dpu_secret_revoke`, `dpu_secret_list`)

No MCP `Client`/`Transport` setup is used. No `mcp-session-id` header is
sent. Errors from DPU are surfaced as thrown `Error`s.

## Helpers

Exported and used by `github-auth.mjs`:

- `getStoredGitToken({ key })`
- `putStoredGitToken({ token, key })` — also best-effort grants the
  calling agent `read` after writing
- `deleteStoredGitToken({ key })`
- `grantStoredGitTokenAccess({ key, principal, role })`

When callers use the default GitHub token key, helpers derive a
user-scoped DPU key from the routed invocation identity:

- `GIT_GITHUB_TOKEN_<16-char SHA-256 suffix>` when a workspace user or
  caller principal is available
- legacy `GIT_GITHUB_TOKEN` only when no routed identity is available, or as a
  read-only fallback for existing stored tokens

Writes and deletes only target the scoped key. They do not overwrite or remove
another user's legacy/global token secret.

## Delegated user propagation

`git_tool.mjs` reads the verified `metadata.invocation` grant and preserves
the raw `metadata.invocationToken`. The secret-store client forwards that
token unchanged as the caller JWT. `gitAgent` never mints a DPU-audience
invocation token.

Chain of custody:

- browser or first-party route authenticates the workspace user
- router issues an invocation JWT to `gitAgent` with `aud` pinned to
  `agent:<repo>/gitAgent`
- `gitAgent` forwards that JWT to the router as `X-Ploinky-Caller-JWT`
- router verifies the caller JWT and mints a fresh invocation JWT with `aud`
  pinned to `agent:<repo>/dpuAgent`
- DPU verifies the provider-audience JWT before exposing `metadata.invocation`
  to domain code

## Scope contract

| operation      | scope          |
|----------------|----------------|
| `dpu_secret_get`   | `secret:read`  |
| `dpu_secret_list`  | `secret:read`  |
| `dpu_secret_put`   | `secret:write` |
| `dpu_secret_delete`| `secret:write` |
| `dpu_secret_grant` | `secret:grant` |
| `dpu_secret_revoke`| `secret:revoke`|

Scopes are named in the router-issued invocation JWT and enforced by DPU. The
manifest no longer declares a `requires.secretStore` block; the client is
intentionally DPU-specific.

## Agent policy

`gitAgent/manifest.json` does not declare any DPU policy. The maximum
role `gitAgent` may receive on any secret is controlled by DPU-owned
policy stored in `permissions.manifest.json -> agentPolicies[<principalId>].secrets.allowedRoles`,
managed by DPU admins through the `dpu_agent_policy_get` /
`dpu_agent_policy_set` tools.
