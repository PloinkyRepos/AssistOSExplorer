# DS01 - DPU Agent Overview

## Summary

`dpuAgent` is the confidential data service used by Explorer for secrets and for the virtual `/Confidential` surface. It exists because those records should not inherit normal filesystem behavior.

## Background / Problem Statement

Explorer can browse and edit ordinary workspace files directly, but that model is not sufficient for:

- secret values that must not be stored in plaintext metadata
- confidential files whose content should be encrypted at rest
- actor-aware access rules
- virtual roots such as `My Space`, `Shared`, and `Secrets`

If these concerns were implemented as ordinary files plus ad-hoc UI logic, the permission boundary would be unclear and storage rules would be duplicated across callers.

## Goals

1. Keep confidential storage behind a dedicated Model Context Protocol (MCP) boundary.
2. Separate metadata, access control list (ACL) state, secret values, and confidential file blobs.
3. Resolve actor identity consistently from auth context before access checks.
4. Expose a stable tool surface for Explorer and related plugins.
5. Support both embedded runtime hosting and standalone Model Context Protocol hosting.

## Non-Goals

- Acting as a general-purpose database service.
- Mirroring confidential state into the regular workspace filesystem.
- Exposing public anonymous access to confidential data.

## Service Boundary

The agent routes all operations through `tools/dpu_tool.mjs` into `lib/dpu-store.mjs`. The store delegates persistence, permissions, and actor resolution into `lib/dpu-store-internal/`. This lets Explorer consume a domain-level contract instead of inspecting storage files or inferring access control list semantics itself.

In practice:

- `dpu_tool.mjs` normalizes the MCP envelope and extracts `metadata.authInfo`
- `dpu-store.mjs` implements the domain operations
- `storage.mjs` owns the storage root, encryption helpers, and file lock
- `permissions-manifest.mjs` owns principal normalization and access control list updates
- `identity-acl.mjs` computes roles and actor-filtered serialization

## Practical Operation

The agent materializes virtual roots through `getWorkspaceRoots()`, including:

- `/Confidential`
- `/Confidential/My Space`
- `/Confidential/Shared`
- `/Confidential/Secrets`

Secrets and confidential objects are listed through separate tool families. Secret values are only materialized for actors whose role allows `read`. Confidential file content is only materialized for actors whose role allows `read`. Mutating operations run under the DPU file lock so metadata and permissions updates stay consistent.
