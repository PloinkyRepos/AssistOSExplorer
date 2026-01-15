# Architecture Layers

This document defines the intended layering rules for the Explorer UI and runtime.

## Layers

1) UI layer
- WebSkel presenters, view models, and UI helpers.
- Must not call MCP/tools directly.

2) Domain / use-cases
- Services that expose intent (e.g., AutocommitService, RepoService, DocumentService).
- Orchestrates workflows but does not depend on UI details.

3) Infrastructure
- Tool adapters (MCP/HTTP), storage, runtime plugin loader, parsing of tool responses.

## Dependency rules

- UI -> Domain -> Infrastructure (one-way only).
- UI must not import infrastructure directly unless explicitly approved.
- Domain should depend only on infrastructure abstractions, not UI code.

## Current migration

- `explorer/services/infrastructure/explorerApi.js` is the canonical tool adapter.
- Runtime plugin helpers are split into core (`explorer/utils/pluginUtils.core.js`)
  and UI (`explorer/utils/pluginUtils.ui.js`).
