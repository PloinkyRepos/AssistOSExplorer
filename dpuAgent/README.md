# DPU Agent

`dpuAgent` is the confidential and research-data service used by Explorer for `/Confidential` and secret storage. It owns unified research-resource records, confirmation-bound actions, jobs, source adapters and append-only provenance. It uses a clean-break `dpu-research-v1` root and does not migrate or read legacy state.

The agent owns three things that Explorer should not implement locally:

- actor-aware access control
- encrypted storage for secret values and confidential file content
- stable virtual roots such as `/Confidential/My Space`, `/Confidential/Shared`, `/Confidential/Secrets`, and admin-only `/Confidential/Audit`
- research projections at `/Confidential/Research Data` and `/Confidential/Jobs`

## Runtime

`dpuAgent` runs as a Ploinky MCP-first agent through the bundled Ploinky `AgentServer.mjs`. Under Ploinky, `DPU_MASTER_KEY` is a per-agent generated secret provided through `{{generatedSecret:DPU_MASTER_KEY}}`, and the router is the only public entry point for DPU MCP calls.

Required or relevant environment variables:

- `DPU_MASTER_KEY`
- `DPU_DATA_ROOT`
- `DPU_WORKSPACE_ROOT`
- `ASSISTOS_FS_ROOT`
- `WORKSPACE_ROOT`

## Documentation

- [DPU specification matrix](./docs/specs/matrix.md)
- [DPU documentation](./docs/index.html)
