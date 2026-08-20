---
title: DS002-ploinky-runtime
summary: Defines the Ploinky startup, routing, authentication, and workspace-root boundaries used by Explorer.
---

# DS002 Ploinky Runtime

## Introduction

Explorer runs as the static Ploinky agent and depends on Ploinky for startup orchestration, router access control, and workspace configuration.

## Core Content

The `explorer/manifest.json` enable list must declare the agents that Explorer requires for its integrated workspace experience. `ploinky start explorer` is the supported local startup command. The Explorer route is served by the Ploinky router and browser access must use the router session rather than direct agent ports.

Explorer must obtain its filesystem roots from the configured runtime environment and enforce those roots for filesystem MCP operations. The browser may bootstrap a display context from `list_allowed_directories`, but it must not treat that result as authorization for paths outside the server-enforced roots.

Ploinky router authentication and secure invocation data are authoritative for protected browser and agent calls. An agent must derive the acting principal from verified invocation context and must not trust a client-declared actor identity.

Repository documentation preview must remain reachable through the repository-scoped route `/.ploinky/repos/AchillesIDE/docs/development.html` when the workspace exposes the repository mount.

## Conclusion

Ploinky provides the deployment and trust boundary; Explorer provides the workspace interface inside that boundary.
