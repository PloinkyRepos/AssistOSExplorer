# DS06 — DPU-aware secret-store client

Status: implemented (2026-04-20)

## Summary

`gitAgent` is explicitly coupled to `dpuAgent`. It uses the client at
`lib/secret-store-client.mjs` to call DPU directly through the router
over a single signed JSON-RPC `tools/call` per operation. No capability
binding lookup and no MCP session setup.

## Client behavior

`lib/secret-store-client.mjs`:

- resolves the DPU principal from the `PLOINKY_DPU_PRINCIPAL` env var,
  defaulting to `agent:AssistOSExplorer/dpuAgent` (canonical
  `agent:<repo>/<agent>` form — Ploinky derives this from the installed
  agent ref)
- requires `PLOINKY_AGENT_PRINCIPAL` to already be set to the canonical
  caller principal (`agent:AssistOSExplorer/gitAgent` in this workspace);
  there is no short-form `agent:<agent>` fallback
- resolves the DPU route name from `PLOINKY_DPU_ROUTE`, defaulting to
  `dpuAgent`
- signs a caller assertion with the agent's Ed25519 private key (loaded
  from `$PLOINKY_AGENT_PRIVATE_KEY_PEM`, `$PLOINKY_AGENT_PRIVATE_KEY_PATH`,
  or `.ploinky/keys/agents/<principal>.key`), with `aud` set to the DPU
  principal
- forwards the router-issued `user_context_token` extracted from the
  current verified invocation in the `x-ploinky-user-context` header
- submits the assertion in `x-ploinky-caller-assertion`
- POSTs a single JSON-RPC `tools/call` request to
  `{router}/mcps/{dpuRoute}/mcp`
- calls only the domain operations
  (`secret_get`, `secret_put`, `secret_delete`, `secret_grant`,
  `secret_revoke`, `secret_list`)

No MCP `Client`/`Transport` setup is used. No `mcp-session-id` header is
sent. Errors from DPU are surfaced as thrown `Error`s.

## Helpers

Exported and used by `github-auth.mjs`:

- `getStoredGitToken({ key })`
- `putStoredGitToken({ token, key })` — also best-effort grants the
  calling agent `read` after writing
- `deleteStoredGitToken({ key })`
- `grantStoredGitTokenAccess({ key, principal, role })`

## Delegated user propagation

`git_tool.mjs` reads the verified `metadata.invocation` grant. When the
invocation carries a `user_context_token`, the secret-store client
forwards that token unchanged. `gitAgent` never mints a user-context
token.

Chain of custody:

- browser or first-party route authenticates the workspace user
- router issues `user_context_token` (aud pinned to the immediate
  downstream agent)
- router embeds that token inside the provider-facing invocation grant
  when calling `gitAgent`
- `gitAgent` forwards the same token (aud now pinned to `gitAgent`) to
  DPU via the caller assertion
- DPU verifies the caller-assertion signature and then verifies the
  user-context-token audience equals the caller-assertion issuer

## Scope contract

| operation      | scope          |
|----------------|----------------|
| `secret_get`   | `secret:read`  |
| `secret_list`  | `secret:read`  |
| `secret_put`   | `secret:write` |
| `secret_delete`| `secret:write` |
| `secret_grant` | `secret:grant` |
| `secret_revoke`| `secret:revoke`|

Scopes are named in the caller assertion and enforced by DPU. The
manifest no longer declares a `requires.secretStore` block; the client
is intentionally DPU-specific.

## Agent policy

`gitAgent/manifest.json` does not declare any DPU policy. The maximum
role `gitAgent` may receive on any secret is controlled by DPU-owned
policy stored in `permissions.manifest.json -> agentPolicies[<principalId>].secrets.allowedRoles`,
managed by DPU admins through the `dpu_agent_policy_get` /
`dpu_agent_policy_set` tools.
