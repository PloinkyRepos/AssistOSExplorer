# DS01 - Ploinky Agent Invariant

## Summary

OnlyOffice Document Server must be represented as a Ploinky-managed agent in this workspace. It must not remain a raw host-managed Podman container started opportunistically by Explorer hooks.

## Core Invariant

The workspace Document Server is a long-running service. Long-running services belong in Ploinky manifests so image selection, env resolution, generated secrets, readiness, profiles, routing metadata, logs, lifecycle, and teardown all flow through the same runtime contract as other workspace infrastructure agents.

The OnlyOffice agent manifest must own:

- the Document Server container image and image tag policy
- the `JWT_ENABLED` and `JWT_SECRET` runtime environment
- `JWT_SECRET` derivation from the same Ploinky-derived `ONLYOFFICE_JWT_SECRET` label used by Explorer
- the internal port and readiness probe
- profile-specific enablement, ports, and lifecycle behavior
- any persistent storage needed by Document Server

Explorer remains the office-session and storage bridge. Explorer must not start, stop, or mutate the Document Server container directly. Explorer may consume the agent's public/internal URLs and may continue to sign editor configs, expose tokenized document and callback routes, and bridge Confidential reads/writes through DPU.

## Disallowed State

A container named like `ploinky_onlyoffice_<workspace>` that is created by an Explorer host hook is not considered compliant with this invariant. Such a container may exist only as a temporary compatibility shim during migration or emergency rollback. It must not be the target production architecture.

## Required Migration Shape

The target shape is:

```text
Ploinky dependency graph
  -> onlyOffice agent
    -> OnlyOffice Document Server container
  -> explorer agent
    -> /services/explorer/office/session
    -> /public-services/explorer/office/document/<token>
    -> /public-services/explorer/office/callback/<token>
    -> DPU delegated MCP for Confidential files
```

This preserves the existing Explorer and DPU responsibility split while moving the Document Server lifecycle under Ploinky.

## Validation

An acceptable deployment must be able to prove without printing secrets that:

- an enabled Ploinky agent owns the OnlyOffice Document Server container
- the agent's `JWT_SECRET` equals Explorer's `ONLYOFFICE_JWT_SECRET`
- the browser can load OnlyOffice `api.js`
- OnlyOffice can fetch tokenized document URLs and post callbacks through Explorer
- Confidential Office documents still resolve through `Explorer -> Ploinky router -> dpuAgent`
