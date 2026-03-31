# EX02 - Plugin Hosting And Dependencies

## Summary

Explorer funcționează ca host pentru pluginuri UI și pentru agenți MCP dependenți. Regula principală este că Explorer deține shell-ul, iar agenții dependenți dețin logica de domeniu și componentele lor.

## Background / Problem Statement

Fără reguli clare, Explorer riscă să absoarbă logică Git, DPU, Tasks sau SOPLang direct în `file-exp`, ceea ce crește coupling-ul și face UI-ul greu de întreținut.

## Goals

1. Să definească ownership clar între host și agenții dependenți
2. Să documenteze plugin slots și dependențele active
3. Să păstreze runtime plugin loading predictibil

## Plugin Inventory

Conform [manifest.json](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/manifest.json), Explorer activează:

- `git`
- `dpu-runtime-support`
- `soplang-builder`
- `tasks`

## Host Slots

Exemple de sloturi de host folosite de integrare:

- `file-exp:toolbar`
- mount points din preview shell
- mount points pentru modale și side-panels

## Dependency Responsibilities

| Dependency | Explorer owns | Dependency owns |
|---|---|---|
| `gitAgent` | toolbar slot, refresh host, repo context | Git workflows, commit modal, repo tree, credentials |
| `dpuAgent` | confidential navigation shell, preview host | storage, ACL, comments, confidential object logic |
| `soplangAgent` | host actions și document context | build logic, markdown sync, skills bridge |
| `tasksAgent` | toolbar slot și document context | backlog CRUD, conflict handling, task UI |
| `llmAssistant` | generic host invocation points | autocomplete, commit message, conflict resolution |

## Behavioral Specification

### Preferred Flow

1. Explorer montează componenta de domeniu
2. Componenta apelează agentul ei prin MCP
3. Componenta emite evenimente spre host
4. Explorer actualizează doar starea de layout și navigation

### Rejected Flow

Explorer nu trebuie să:

- reimplementeze tool logic de domeniu
- genereze manual HTML de domeniu când există deja plugin dedicat
- devină proxy obligatoriu pentru toate mutațiile de domeniu

## Related Specs

- [Explorer Plugin Agent Spec](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/docs/EXPLORER_PLUGIN_AGENT_SPEC.md)
- [gitAgent plugin spec](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/gitAssistant/gitAgent/docs/specs/GA/GA02-explorer-plugin.md)
- [tasksAgent plugin spec](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/tasksAssistant/tasksAgent/docs/specs/TA/TA02-explorer-plugin.md)
