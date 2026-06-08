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
- requires the current router-issued invocation JWT to prove the Git call is
  running inside a routed workspace invocation
- signs a DS013 Agent Assertion with `PLOINKY_AGENT_SECRET` and sends it as
  `Authorization: Bearer <assertion>` to the router
- POSTs a single JSON-RPC `tools/call` request to
  `{router}/{dpuRoute}/mcp`
- maps Git-owned secret operations to DPU's internal agent aliases
  (`dpu_agent_secret_get`, `dpu_agent_secret_put`,
  `dpu_agent_secret_delete`, `dpu_agent_secret_grant`,
  `dpu_agent_secret_revoke`, `dpu_agent_secret_list`)

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
the raw `metadata.invocationToken`. The secret-store client uses that presence
check to reject out-of-band secret access, then authenticates the Git-to-DPU
hop with an Agent Assertion signed by `gitAgent`'s own
`PLOINKY_AGENT_SECRET`. `gitAgent` never mints a DPU-audience invocation
token.

Chain of custody:

- browser or first-party route authenticates the workspace user
- router issues an invocation JWT to `gitAgent` with `aud` pinned to
  `agent:<repo>/gitAgent`
- `gitAgent` derives the user-scoped token key from that verified invocation
  and signs an Agent Assertion for the internal DPU secret alias
- router verifies the source agent assertion, applies MCP policy, and mints a
  fresh Router Request with `aud` pinned to `agent:<repo>/dpuAgent`
- DPU verifies the Router Request before exposing `metadata.invocation` to
  domain code

## Scope contract

| Git client operation | DPU internal tool | DPU role |
|----------------------|-------------------|----------|
| `dpu_secret_get` | `dpu_agent_secret_get` | `read` |
| `dpu_secret_list` | `dpu_agent_secret_list` | `read` |
| `dpu_secret_put` | `dpu_agent_secret_put` | `write` |
| `dpu_secret_delete` | `dpu_agent_secret_delete` | `write` |
| `dpu_secret_grant` | `dpu_agent_secret_grant` | `write` |
| `dpu_secret_revoke` | `dpu_agent_secret_revoke` | `write` |

The router policy only permits agents to call `internal` MCP tools. DPU then
enforces per-secret ACLs and `agentPolicies[<principalId>].secrets.allowedRoles`.
The manifest no longer declares a `requires.secretStore` block; the client is
intentionally DPU-specific.

## Agent policy

`gitAgent/manifest.json` does not declare any DPU policy. The maximum
role `gitAgent` may receive on any secret is controlled by DPU-owned
policy stored in `permissions.manifest.json -> agentPolicies[<principalId>].secrets.allowedRoles`,
managed by DPU admins through the `dpu_agent_policy_get` /
`dpu_agent_policy_set` tools.
