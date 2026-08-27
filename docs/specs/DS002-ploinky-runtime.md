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

Release evidence for a managed Ploinky Box must accept exactly the runtime's semantic label schema. That schema binds the selected achillesAgentLib mode, source-identity hash, content fingerprint, workspace-relative source path, and optional Git commit alongside the Box identity, immutable image, cache fingerprints, and two-publication network boundary. A release-manifest gate must reject a running Box whose AgentLib commit does not equal the verified manifest commit, and its post-browser check must prove that the full semantic-label set and outer generation did not change. The ordinary Copilot release gate requires the manifest's exact immutable image digest and reference plus a fresh outer generation; it must not reinterpret the fixed OCI creation time of that pinned release image as deployment age. Gates whose purpose includes fresh-image validation retain their bounded image-age requirement.

The tracked Explorer QA deployment must derive the canonical achillesAgentLib URL and immutable commit from the selected Ploinky runtime's dependency lock. It must reject a noncanonical source, a malformed commit, or a locked commit that differs from the selected remote default-branch head; leave AgentLib selection on that immutable lock rather than applying one mutable global branch to both AgentLib and application repositories; retain explicit per-repository graph branches; and never set a retired AgentLib selection environment variable. Process admission is necessary but does not establish readiness: the deployment must bind all fourteen expected no-wait markers to the current deployment start, reject mixed, stale, malformed, or terminal-failed evidence, and require every corresponding run-scoped status to reach terminal `running` before its stable-ready streak can advance. After all expected runtimes are admitted and semantically ready, deployment evidence must execute Ploinky's graph attestation and prove that the core plus every expected agent share the locked commit, content fingerprint, physical source identity, package hash, entry-point hashes, and stable read-only source root.

Marketplace reads use the authenticated router session. Before an administrator installs or uninstalls a repository or enables or disables an agent, Explorer must obtain the local, session-bound administrative control proof from the router, verify that its origin exactly matches the current browser origin, and send it with the Marketplace mutation. Explorer must not persist this proof in component state or weaken the router check when the proof is absent or invalid. Only one agent mutation may be pending at a time; runtime-mode selection remains a stable native control, and mutation failures stay visible until explicitly dismissed. Marketplace normalizes runtime evidence to Disabled, Starting up, Running, Stopped, Failed, Paused, or Unknown; it refreshes Starting up agents and exposes Configure only for a verified Running runtime.

Repository documentation preview must remain reachable through the repository-scoped route `/.ploinky/repos/AchillesIDE/docs/development.html` when the workspace exposes the repository mount.

## Conclusion

Ploinky provides the deployment and trust boundary; Explorer provides the workspace interface inside that boundary.
