# DPU Agent

`dpuAgent` is the confidential data service used by Explorer for `/Confidential` and for secret storage. It keeps this data outside normal filesystem flows and exposes it through Model Context Protocol (MCP) tools instead.

The agent owns three things that Explorer should not implement locally:

- actor-aware access control
- encrypted storage for secret values and confidential file content
- stable virtual roots such as `/Confidential/My Space`, `/Confidential/Shared`, `/Confidential/Secrets`, and admin-only `/Confidential/Audit`

## Runtime

`dpuAgent` can run under the Ploinky runtime or as a standalone HTTP Model Context Protocol server. Under Ploinky, `DPU_MASTER_KEY` is a per-agent generated secret derived from `PLOINKY_DERIVED_MASTER_KEY` through `{{generatedSecret:DPU_MASTER_KEY}}`; standalone runs must still provide `DPU_MASTER_KEY` explicitly.

Standalone entry point:

```bash
npm install
DPU_MASTER_KEY=... DPU_DATA_ROOT=... node ./server/standalone-mcp-server.mjs
```

Standalone endpoints:

- `POST /mcp`
- `GET /health`

Required or relevant environment variables:

- `DPU_MASTER_KEY`
- `DPU_DATA_ROOT`
- `DPU_WORKSPACE_ROOT`
- `ASSISTOS_FS_ROOT`
- `WORKSPACE_ROOT`

## Documentation

- [DS01 - DPU Agent Overview](./docs/specs/DS01-vision.md)
- [DS02 - Storage Architecture](./docs/specs/DS02-storage-architecture.md)
- [DS03 - Secrets Model](./docs/specs/DS03-secrets-model.md)
- [DS04 - Confidential Objects Model](./docs/specs/DS04-confidential-objects.md)
- [DS05 - Runtime and MCP Interface](./docs/specs/DS05-runtime-and-mcp.md)
- [DS06 - Explorer-Facing DPU Model](./docs/specs/DS06-secrets-product-model.md)
