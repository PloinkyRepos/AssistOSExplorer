# DS01 - Ploinky Agent Invariant

## Summary

OnlyOffice Document Server is owned by the Ploinky-managed `onlyOffice` agent in this workspace. The agent owns its image, derived JWT secret, internal port, readiness probe, profile-specific lifecycle, and persistent storage. Explorer remains the office-session and storage bridge but does not own the Document Server container.

Status: implemented.

## Core Invariant

The workspace Document Server is a long-running service. Long-running services belong in Ploinky manifests so image selection, env resolution, generated secrets, readiness, profiles, routing metadata, logs, lifecycle, and teardown all flow through the same runtime contract as other workspace infrastructure agents.

The OnlyOffice agent manifest (`onlyOffice/manifest.json`) owns:

- the Document Server container image, pinned via `${ONLYOFFICE_VERSION}` (no `:latest`)
- `JWT_ENABLED=true` and required `JWT_SECRET` injected by Ploinky env resolution
- `JWT_SECRET` derivation via `derive: "derived-master"` with `deriveRepoName: "AchillesIDE"`, `deriveAgentName: "explorer"`, `deriveName: "ONLYOFFICE_JWT_SECRET"`. This identity matches Explorer's own `ONLYOFFICE_JWT_SECRET` derivation, so both sides resolve to the same hex value without coordination beyond the manifest
- the internal container port (`80`) published on `127.0.0.1:8082` (default and `prod` profiles) or `127.0.0.1:18082` (`dev` profile)
- explicit runtime startup through `entrypoint: "/bin/bash"` and `start: "/app/ds/run-document-server.sh"` so Ploinky runs the image's Document Server process rather than the implicit AgentServer
- `readiness.protocol: "tcp"`, probed on the published host port; deployment validation must still fetch `api.js` because TCP readiness proves the port is open, not that the editor API has fully warmed
- profile-specific ports, env defaults, and lifecycle hooks
- bind-mounted persistent storage under `.ploinky/data/onlyOffice/` for `log`, `data`, `lib`, `postgresql`, `rabbitmq`, and `redis` volumes

Explorer remains the office-session and storage bridge. Explorer does not start, stop, or mutate the Document Server container directly. Explorer consumes `ONLYOFFICE_PUBLIC_URL`, `ONLYOFFICE_INTERNAL_URL`, `ONLYOFFICE_CALLBACK_BASE_URL`, and `ONLYOFFICE_JWT_SECRET` through Ploinky-managed env (deploy-workflow vars in production; defaulted by `onlyOffice/scripts/hooks/preinstall.sh` for local dev).

## Disallowed State

A container named like `ploinky_onlyoffice_<workspace>` that is created by an Explorer host hook is not compliant with this invariant. The Explorer preinstall hook no longer creates such a container. The `onlyOffice` agent's preinstall script first verifies that the target Document Server image is locally available or pullable, then removes any leftover `ploinky_onlyoffice_<workspace>` container as a one-time migration step before binding host port `8082`. If the pull or removal fails, the hook exits non-zero so a deploy cannot delete the working sidecar and then continue into a broken replacement.

## Implementation Layout

```text
Ploinky dependency graph
  -> onlyOffice agent (this directory)
    -> docker.io/onlyoffice/documentserver:${ONLYOFFICE_VERSION}
    -> JWT_SECRET derived from AchillesIDE/explorer/ONLYOFFICE_JWT_SECRET
    -> bind-mounted volumes under .ploinky/data/onlyOffice/
  -> explorer agent
    -> /services/explorer/office/session
    -> /public-services/explorer/office/document/<token>
    -> /public-services/explorer/office/callback/<token>
    -> DPU delegated MCP for Confidential files
```

The Document Server image is pinned to `9.3.1` by default, matching the Docker tag for the previously-deployed 9.3.1 package line without including the package build-revision suffix. Operators override the pin via the `WEBMEET_LIVEKIT_VERSION`-style precedence chain: `ploinky var ONLYOFFICE_VERSION <tag>` overrides the manifest default.

## Migration Notes

The previous raw `ploinky_onlyoffice_<workspace>` sidecar used anonymous podman volumes for `/var/www/onlyoffice/Data`, `/var/lib/onlyoffice`, `/var/lib/postgresql`, `/var/lib/rabbitmq`, `/var/lib/redis`, and `/var/log/onlyoffice`. The new agent uses bind mounts under `.ploinky/data/onlyOffice/`, so on the first start with the new agent these volumes start empty.

Practical consequences:

- in-progress collaborative editing sessions held by the legacy sidecar's internal databases are cut off when the legacy container is removed
- OnlyOffice rebuilds its document key registry on demand the next time a user opens a document, so steady-state editing recovers without operator intervention
- if an operator needs to preserve in-progress state across the migration, they must `podman volume export` the legacy named volumes before the next deploy and rehydrate them into the new bind paths

The agent does not encode that operator-driven volume migration; it removes the legacy container only after the target image preflight succeeds, so the new agent can bind port `8082` without making an image-pull failure destructive.

## Validation

An acceptable deployment must be able to prove without printing secrets that:

- a Ploinky-managed `onlyOffice` agent owns the OnlyOffice Document Server container (visible in `ploinky status` and `podman ps`)
- the agent's `JWT_SECRET` env equals Explorer's `ONLYOFFICE_JWT_SECRET` env (boolean equality only; never print either value)
- the browser can load OnlyOffice `api.js` from `${ONLYOFFICE_PUBLIC_URL}/web-apps/apps/api/documents/api.js`
- the deployment path can load OnlyOffice `api.js` from `${ONLYOFFICE_INTERNAL_URL}/web-apps/apps/api/documents/api.js` after Ploinky TCP readiness passes
- OnlyOffice can fetch tokenized document URLs and post callbacks through Explorer's `/public-services/explorer/office/` routes
- Confidential Office documents still resolve through `Explorer -> Ploinky router -> dpuAgent`
