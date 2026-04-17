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
2. extracts `metadata.authInfo`
3. normalizes the input object
4. validates required fields and enum-like values
5. dispatches into `lib/dpu-store.mjs`

In standalone mode, `server/standalone-mcp-server.mjs` loads the same `mcp-config.json`, registers the same tools, and still routes execution through the same wrapper and dispatcher.

For HTTP callers, auth context is carried in the `x-ploinky-auth-info` header. The standalone server must accept both a plain JSON payload and a Base64-encoded JSON payload in that header before resolving `metadata.authInfo`. This keeps inter-agent callers compatible while preserving authenticated access checks for secret and confidential operations.

The auth payload may also include optional agent context, for example:

```json
{
  "user": { "id": "local:admin", "username": "admin" },
  "agent": { "name": "gitAgent", "principalId": "agent:gitAgent" },
  "sessionId": "..."
}
```

When both `user` and `agent` are present, DPU keeps ownership and user-space resolution anchored to the authenticated user principal while access control list evaluation may match either the user principal or the agent principal. Agent identity should be configured by the calling agent manifest and then registered in `permissions.manifest.json` as a first-class principal. When DPU grants a secret role to an agent principal, it must validate the requested role against the target agent's `manifest.json -> permissions.secrets.allowedRoles`.

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

## Practical Guarantees

`mcp-config.json` sets `maxParallelTasks` to `1`. Mutating operations also run under the DPU file lock. This gives the runtime a simple single-writer discipline even though the agent is file-backed.

Authorization is enforced before sensitive material is returned. In practical terms, a caller may receive an object or secret record with limited fields while the encrypted secret value or confidential file content remains hidden because the resolved role does not allow it.
