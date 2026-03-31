# EX01 - Explorer System Overview

## Summary

`explorer` este agentul static al workspace-ului Ploinky. El expune interfața web principală pentru navigare în fișiere, preview, document editing, integrare MCP și montarea pluginurilor de aplicație.

## Background / Problem Statement

Workspace-ul are nevoie de un host UI unic care să:

- navigheze filesystem-ul și repo-urile din workspace
- integreze agenți MCP specializați fără a muta logica de domeniu în host
- ofere preview, editare și acțiuni comune într-o singură aplicație
- funcționeze ca static agent servit de routerul Ploinky

## Goals

1. Să fie host-ul principal al workspace-ului
2. Să păstreze separarea dintre infrastructura UI și logica de domeniu
3. Să integreze agenți dependenți prin MCP și runtime plugins
4. Să expună filesystem, preview și document flows într-un mod coerent

## Non-Goals

- implementarea logicii Git, DPU, Tasks, SOPLang sau LLM în core-ul Explorer
- duplicarea contractelor MCP ale agenților dependenți
- orchestration complet de servicii externe în UI layer

## Architecture Overview

```
Browser UI
  -> RoutingServer
    -> explorer (static HTTP + MCP)
      -> file-exp page / preview / document UI
      -> runtime plugin loader
      -> explorer services + server routes
        -> dependent MCP agents
```

### Main Layers

| Layer | Responsibility |
|---|---|
| `web-components/` | pagini, componente, modale, host UI |
| `services/` | logică front-end și integrare runtime |
| `utils/server/` | routes HTTP, config server-side, store-uri și adaptoare |
| `filesystem-http-server.mjs` | serverul principal al agentului |

## Data Models

### Core Navigation State

Explorer menține stări pentru:

- `path`
- selecția curentă
- `directoryViewMode`
- preview state
- document state
- plugin/runtime state

### Dependency Model

Dependențele declarate în [manifest.json](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/manifest.json) includ:

- `gitAssistant/gitAgent global`
- `dpuAssistant/dpuAgent global`
- `soplangBuilder/soplangAgent global`
- `tasksAssistant/tasksAgent global`
- `llmAssistant/llmAssistant global`
- plus serviciile `postgres` și `keycloak`

## API Contracts

### Static UI Contract

Explorer servește aplicația web principală și resursele statice pentru router.

### MCP / HTTP Integration Contract

Explorer consumă agenți dependenți prin:

- MCP routes proxiate de Ploinky
- HTTP routes proprii pentru sesiuni, preview și document flows

### Plugin Contract

Pluginurile de aplicație sunt descoperite prin `applicationPlugins` din manifest și sunt montate în sloturi Explorer, de exemplu `file-exp:toolbar`.

## Behavioral Specification

### Startup

1. Ploinky pornește dependențele declarate
2. Explorer pornește ca static agent
3. Routerul publică aplicația Explorer
4. Runtime plugin loader încarcă pluginurile active

### Navigation

Explorer gestionează:

- list view și tree view
- breadcrumb și URL sync
- preview și editare
- mount points pentru componente de domeniu

## Configuration

### Required / Relevant Environment

- `ASSISTOS_FS_ROOT`
- `ONLYOFFICE_PUBLIC_URL`
- `ONLYOFFICE_INTERNAL_URL`
- `ONLYOFFICE_JWT_SECRET`
- `ONLYOFFICE_CALLBACK_BASE_URL`
- `SOUL_GATEWAY_API_KEY`

## Related Specs

- [EX02 - Plugin Hosting And Dependencies](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/docs/specs/EX/EX02-plugin-hosting-and-dependencies.md)
- [OnlyOffice Integration](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/docs/onlyoffice.md)
- [Confidential Files](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/docs/confidential-files.md)
