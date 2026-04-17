# DS06 — secret-store/v1 client

Status: implemented (2026-04-17)

## Summary

gitAgent no longer talks to the DPU directly. It declares

```json
"requires": {
  "secretStore": { "contract": "secret-store/v1", "maxScopes": ["secret:read", "secret:write"] }
}
```

and uses the generic client at `lib/secret-store-client.mjs`, which
routes every call through the workspace router.

## What changed

- **Removed**: `lib/dpu-secret-client.mjs`. It loaded
  `.ploinky/routing.json`, hard-coded the `dpuAgent` route, and forged an
  `x-ploinky-auth-info` header.
- **Added**: `lib/secret-store-client.mjs`. It:
  - resolves the provider from the workspace capability binding
    (`gitAgent:secretStore`) injected by the launcher
  - signs a caller assertion with the agent's Ed25519 private key (loaded
    from `$PLOINKY_AGENT_PRIVATE_KEY_PEM`,
    `$PLOINKY_AGENT_PRIVATE_KEY_PATH`, or
    `.ploinky/keys/agents/<principal>.key`)
  - submits the assertion in the `x-ploinky-caller-assertion` header so
    the router can mint a signed `invocation_token` that the provider
    verifies
  - calls only the generic contract operations
    (`secret_get`, `secret_put`, `secret_delete`, `secret_grant`,
    `secret_revoke`, `secret_list`)
  - forwards the router-issued `user_context_token` extracted from the
    current verified invocation so nested capability calls preserve the
    authenticated delegated user across hops

## Helpers

Exported and used by `github-auth.mjs`:

- `getStoredGitToken({ key })`
- `putStoredGitToken({ token, key })` — also best-effort grants the
  calling agent `read` after writing
- `deleteStoredGitToken({ key })`
- `grantStoredGitTokenAccess({ key, principal, role })`

Each helper opens a short-lived MCP session, signs the assertion, makes
the call, and closes.

## Delegated user propagation

`git_tool.mjs` now prefers the verified `metadata.invocation` grant over
legacy `metadata.authInfo`. When the current invocation carries a
`user_context_token`, the secret-store client forwards that token in the
next caller assertion instead of synthesizing user identity locally.

This keeps the chain of custody inside router-issued signatures:

- browser or first-party route authenticates the workspace user
- router issues `user_context_token`
- router embeds that token inside the provider-facing invocation grant
- `gitAgent` forwards the same token when it calls `secret-store/v1`
- the router verifies it again before minting the next invocation token

## Scope contract

| operation      | scope          |
|----------------|----------------|
| `secret_get`   | `secret:read`  |
| `secret_list`  | `secret:read`  |
| `secret_put`   | `secret:write` |
| `secret_delete`| `secret:write` |
| `secret_grant` | `secret:grant` |
| `secret_revoke`| `secret:revoke`|

The `requires.secretStore.maxScopes` in the manifest is the upper bound
that the consumer is even allowed to ask for. The provider enforces the
intersection of consumer max, binding-approved, and provider-supported
scopes at call time.
