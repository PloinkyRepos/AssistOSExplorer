# DS06 — DPU-aware secret-store client

Status: implemented (2026-04-20)

## Summary

`gitAgent` is explicitly coupled to `dpuAgent`. It uses the client at
`lib/secret-store-client.mjs` to call DPU through the router over a single
JSON-RPC `tools/call` per operation. User-owned GitHub token operations require
a router-minted `dpuGitSecrets` User Delegation Grant carried on
`authInfo.delegations`; the client forwards that grant as
`x-ploinky-user-delegation` while authenticating itself with a DS013 Agent
Assertion. No capability binding lookup and no MCP session setup.

## Client behavior

`lib/secret-store-client.mjs` uses Ploinky's shared `AgentMcpClient` for each
direct tool call. That client:

- resolves the DPU route name from `PLOINKY_DPU_ROUTE`, defaulting to
  `dpuAgent`
- requires the current router-issued invocation JWT to prove the Git call is
  running inside a routed workspace invocation
- extracts the configured `dpuGitSecrets` delegation from `authInfo.delegations`
  for user-owned GitHub token reads, writes, grants, and deletes
- signs a DS013 Agent Assertion with `PLOINKY_AGENT_SECRET` and sends it as
  `Authorization: Bearer <assertion>` to the router
- POSTs a single JSON-RPC `tools/call` request to
  `{router}/{dpuRoute}/mcp`
- delegates Router transport and canonical authority verification to the mounted
  `AgentMcpClient` descriptor client, so the Git agent owns no direct Router
  socket or protected transport override
- calls authenticated DPU `dpu_secret_*` tools when the user delegation is
  present
- falls back to DPU's internal agent aliases only when explicitly allowed for
  compatibility, such as deleting a stale pre-delegation agent-owned token
  record

No MCP `Client`/`Transport` setup is used. No `mcp-session-id` header is
sent. Errors from DPU are surfaced as thrown `Error`s.

## Helpers

Exported and used by `github-auth.mjs`:

- `getStoredGitToken({ key })`
- `putStoredGitToken({ token, key })` — writes a user-owned DPU secret and
  grants the calling agent `read` after writing
- `deleteStoredGitToken({ key })`
- `grantStoredGitTokenAccess({ key, principal, role })`

When callers use the default GitHub token key, helpers derive a
user-scoped DPU key from the routed invocation identity:

- `GIT_GITHUB_TOKEN_<16-char SHA-256 suffix>` when a workspace user or
  caller principal is available
- legacy `GIT_GITHUB_TOKEN` only when no routed identity is available, or as a
  read-only fallback for existing stored tokens

Writes and deletes only target the scoped key. They do not overwrite or remove
another user's legacy/global token secret. Guest callers do not receive
delegations; status-style reads return no stored token and writes/deletes fail
with an explicit sign-in-required error.

## Delegated user propagation

`git_tool.mjs` reads the verified `metadata.invocation` grant, exposes
`authInfo.delegations`, and preserves the raw `metadata.invocationToken`. The
secret-store client uses that presence check to reject out-of-band secret
access, then authenticates the Git-to-DPU hop with an Agent Assertion signed by
`gitAgent`'s own `PLOINKY_AGENT_SECRET`. `gitAgent` never mints a DPU-audience
invocation token or a User Delegation Grant.

Chain of custody:

- browser or first-party route authenticates the workspace user
- router issues an invocation JWT to `gitAgent` with `aud` pinned to
  `agent:<repo>/gitAgent`; for configured GitHub auth tools, the same Router
  Request includes a plural `delegations.dpuGitSecrets` entry
- `gitAgent` derives the user-scoped token key from that verified invocation
  and signs an Agent Assertion for the authenticated DPU secret tool
- router verifies the source agent assertion and the source-bound
  `x-ploinky-user-delegation`, applies MCP policy, and mints a fresh Router
  Request with `aud` pinned to `agent:<repo>/dpuAgent`, `usr` set to the
  original user, and singular `delegation` metadata describing the grant used
- DPU verifies the Router Request before exposing `metadata.invocation` to
  domain code

## Scope contract

| Git client operation | Normal delegated DPU tool | Delegation scope / role |
|----------------------|---------------------------|-------------------------|
| read stored token | `dpu_secret_get` | `secret:read` / `read` |
| write stored token | `dpu_secret_put` | `secret:write` / owner write |
| delete stored token | `dpu_secret_delete` | `secret:write` / owner write |
| grant gitAgent token read | `dpu_secret_grant` | `secret:grant` / capped to `read` |

The router normally permits agents to call only `internal` MCP tools. The
DS013/DS014 delegated-user exception allows the specific source-bound GitHub
auth call to reach authenticated DPU tools when the router verifies the
`dpuGitSecrets` grant. DPU then enforces per-secret ACLs and
`agentPolicies[<principalId>].secrets.allowedRoles`. The manifest no longer
declares a `requires.secretStore` block; the client is intentionally
DPU-specific.

## Stale agent-owned records

Deployments that stored GitHub tokens before the delegated-user path may
contain an agent-owned record for the current user's derived key. A delegated
write that hits `Access denied` may delete that stale record through
`dpu_agent_secret_delete` using the agent-owned compatibility path, then retry
the write through `dpu_secret_put` with the user delegation. Missing
delegation, grant failure, delete failure, and unexpected DPU transport errors
remain fail-loud; `git_auth_disconnect` must not report success while the token
persists.

## Agent policy

`gitAgent/manifest.json` does not declare any DPU policy. The maximum
role `gitAgent` may receive on any secret is controlled by DPU-owned
policy stored in `permissions.manifest.json -> agentPolicies[<principalId>].secrets.allowedRoles`,
managed by DPU admins through the `dpu_agent_policy_get` /
`dpu_agent_policy_set` tools.
