# SA01 - SOPLang Agent Overview

## Summary

`soplangAgent` expune tooluri MCP pentru sync de documente markdown, build incremental și integrarea skill-urilor SOPLang.

## Background / Problem Statement

Explorer trebuie să poată declanșa fluxuri SOPLang fără a incorpora parserul, registry-ul de comenzi sau skill bridge-ul în UI core.

## Goals

1. Să expună build și sync logic prin MCP
2. Să păstreze scanning-ul markdown la nivel de workspace
3. Să se integreze în Explorer ca domain agent, nu ca cod host

## Architecture Overview

| Area | Responsibility |
|---|---|
| `plugins/lib/soplangBuilderCore.mjs` | build orchestration |
| `plugins/lib/achillesSkillsCore.mjs` | skill bridge |
| `plugins/lib/workspaceRoots.mjs` | root detection și document walk |
| `plugins/` | wrap-uri subțiri pentru runtime |

## API Contracts

Tooluri cheie:

- `sync_markdown_documents`
- `execute_incremental_build`
- `execute_workspace_build`
- `build_from_specs_markdown`
- `get_variables_with_values`
- `execute_skill`

## Configuration

Variabile relevante:

- `ACHILLES_DEBUG`
- `SOUL_GATEWAY_API_KEY`
- opțional `SOPLANG_WORKSPACE_ROOT`

## Explorer Integration

Explorer activează pluginul `soplang-builder` și consumă acest agent pentru flows de document/build, dar ownership-ul logicii rămâne în `soplangAgent`.
