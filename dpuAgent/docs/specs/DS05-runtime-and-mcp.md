# DS05 - Runtime and Model Context Protocol Interface

## Summary

`dpuAgent` exposes its domain through Model Context Protocol (MCP) tools declared in `mcp-config.json`. The same contract is used whether the agent runs under Ploinky or through the standalone HTTP MCP server.

## Background / Problem Statement

Explorer and related plugins need a stable way to call the confidential domain. They should not depend on internal storage files or guess how actor identity should be resolved. The runtime layer therefore needs to do two things reliably:

- normalize the incoming request envelope
- dispatch into the domain layer with validated inputs and auth context

## Dispatch Boundary

Each Model Context Protocol tool entry in `mcp-config.json` points to `tools/dpu_tool.sh`, which launches `tools/dpu_tool.mjs`. The tool dispatcher:

1. parses the Model Context Protocol envelope
2. reads the verified `metadata.invocation` grant
3. normalizes the input object
4. validates required fields and enum-like values
5. dispatches into `lib/dpu-store.mjs`

In standalone mode, `server/standalone-mcp-server.mjs` loads the same `mcp-config.json`, registers the same tools, and still routes execution through the same wrapper and dispatcher.

For routed callers, the trusted auth context is carried by a router-issued DS011 invocation JWT in the HTTP `Authorization: Bearer <jwt>` header. Direct delegated agent calls send the caller's current invocation JWT to the router as `X-Ploinky-Caller-JWT`; the router verifies it and mints a fresh provider-audience invocation JWT for DPU. The MCP runtime must verify `typ`, `iss`, `aud`, `tool`, `bh`, `exp`, and `jti` before exposing delegated user or caller-agent data to the domain layer. Legacy `x-ploinky-invocation`, `x-ploinky-caller-assertion`, `x-ploinky-user-context`, and `x-ploinky-auth-info` headers are not trusted.

The auth payload may also include optional agent context, for example:

```json
{
  "usr": { "id": "local:admin", "username": "admin" },
  "caller": "agent:AssistOSExplorer/gitAgent",
  "aud": "agent:AssistOSExplorer/dpuAgent"
}
```

Agent principals are derived by Ploinky from the installed agent ref as `agent:<repo>/<agent>`; manifests no longer declare their own `identity` block. When both `user` and `agent` are present, DPU keeps ownership and user-space resolution anchored to the authenticated user principal while access control list evaluation may match either the user principal or the agent principal directly — short-name aliases like `agent:gitAgent` are no longer recognized.

When DPU grants a secret role to an agent principal, it validates the requested role against DPU-owned policy stored in `permissions.manifest.json -> agentPolicies[<principalId>].secrets.allowedRoles`. No agent manifest is consulted. If no policy exists for the principal, the grant is rejected. Admins configure these policies through the `dpu_agent_policy_get` / `dpu_agent_policy_set` tools.

## Tool Families

The current tool families are:

- actor identity and roots
- audit configuration and audit file access
- secrets
- confidential objects
- confidential comments
- grants, revokes, and access checks

This is a domain surface, not a storage-debug surface. The caller asks for secret or confidential operations, not for direct reads and writes of internal DPU files.

## Audit-Specific Contract

`dpuAgent` exposes dedicated audit tools instead of treating audit logs as generic confidential files:

- `dpu_audit_config_get`
- `dpu_audit_config_set`
- `dpu_audit_list`
- `dpu_audit_get`
- `dpu_audit_event_append`

Audit file writes happen through two controlled paths:

- internal DPU domain auditing for secret and confidential operations
- the dedicated `dpu_audit_event_append` ingest tool for Explorer-side events such as file open, file update, plugin usage, UI actions, and copilot prompt/response

Browser clients and other agents must not write audit files directly. They can only submit events through the dedicated ingest tool, and DPU remains the component that materializes JSONL files on disk.

Audit viewing and audit configuration are restricted to trusted actors:

- a local authenticated `admin` user
- or actors with role `admin`
- or actors with role `security`

The runtime must enforce this before listing or reading `/Confidential/Audit` and before mutating audit configuration.

Audit collection starts disabled by default. A trusted actor must explicitly enable it through `dpu_audit_config_set` before DPU begins appending operational audit records.

## Practical Guarantees

`dpuAgent/manifest.json` requests `lite-sandbox: true`, so Ploinky should prefer the host sandbox runtime for the agent when the host supports it and use the container image only when host sandboxing is disabled.

`mcp-config.json` sets `maxParallelTasks` to `1`. Mutating operations also run under the DPU file lock. This gives the runtime a simple single-writer discipline even though the agent is file-backed.

Authorization is enforced before sensitive material is returned. In practical terms, a caller may receive an object or secret record with limited fields while the encrypted secret value or confidential file content remains hidden because the resolved role does not allow it.
