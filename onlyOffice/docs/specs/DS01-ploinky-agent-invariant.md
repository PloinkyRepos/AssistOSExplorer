# DS01 - Ploinky Agent Invariant

## Summary

OnlyOfficeAgent is a Ploinky-managed decorator runtime that fronts the workspace OnlyOffice Document Server and owns the Office session, document, callback, and persistence boundary for this workspace.

Status: implemented.

## Core Invariant

OnlyOfficeAgent is not a thin sidecar anymore. It is the single workspace-owned Office runtime boundary for:

- authenticated session creation at `GET /services/onlyoffice/office/session`
- signed OnlyOffice config generation
- storage metadata resolution before signing edit/comment permissions
- opaque session-token storage for Office document/callback requests
- path-confined workspace persistence for non-Confidential files
- delegated Confidential persistence through `dpuAgent`
- public editor asset and WebSocket proxying for the browser-visible OnlyOffice surface

Explorer remains the IDE shell and document picker, but it no longer owns Office download routes, callback routes, session/config building, or DPU persistence for Office edits.

## Runtime Boundary

OnlyOfficeAgent owns three distinct HTTP planes:

1. Protected router plane:
   - `/services/onlyoffice/office/session`
- authenticated through the router only
- source of the router-verified acting user and router-minted user delegation grant
- returns only browser-safe preview metadata; it must never return DPU delegation tokens
2. Loopback-only storage plane:
   - `/internal/document/<token>`
   - `/internal/callback/<token>`
   - bound only on loopback and never published through `httpServices` or manifest `ports`
3. Public editor plane:
   - only the required editor assets, including OnlyOffice-generated `/<version-hash>/web-apps/*` iframe assets, root editor runtime files (`/document_editor_service_worker.js`, `/<version-hash>/plugins.json`, `/<version-hash>/themes.json`), and `/doc/*` co-authoring WebSocket paths
- must block command, convert, demo, welcome, info, internal, and healthcheck endpoints from the internet
- must strip browser cookies, `Authorization`, proxy authorization, and caller-supplied `x-ploinky-*` identity headers before forwarding to Document Server
- must advertise the public origin to Document Server on both HTTP and WebSocket forwards: preserve incoming `X-Forwarded-Host`/`X-Forwarded-Proto` when an outer proxy (for example the Cloudflare tunnel) set them, otherwise fill `X-Forwarded-Host` from the incoming `Host` header and `X-Forwarded-Proto` with `http`. Document Server mints browser-facing cache-file URLs and redirects from these headers; because the forwarders rewrite `Host` to the internal target, omitting them makes the editor download converted documents from `http://127.0.0.1/` (no public port) and fail with `Download failed.`

The protected control listener on container port `7000` is a router-mediated private surface. Every profile declares `additionalServerPort: "7000"`, so Ploinky creates an ephemeral localhost route for the `httpServices` mapping to `/control/*` without making the socket eligible for outer-box publication. The browser-facing editor proxy on container port `8080` is reached only by Web Publishing over the `office-publishing` attachment, and the storage listener on `9100` remains container loopback.

OnlyOffice declares no profile `openPorts`. Publishing either the control listener or editor proxy would make that socket eligible to cross the managed Ploinky-box boundary, bypassing the intended router and Web Publishing consolidation paths. The private `additionalServerPort` route is distinct from `openPorts`, and named-network access to `onlyoffice:8080` requires no host publication.

OnlyOfficeAgent's network contract is primary `office-publishing` with no secondary attachments and no manifest-declared aliases. Ploinky derives the network-scoped DNS name `onlyoffice` from the canonical `onlyOffice` agent id. Web Publishing uses `http://onlyoffice:8080` on this trust zone; the explicit port is part of the upstream contract. OnlyOffice does not join `webmeet-signaling` or `webmeet-turn`. Its bundled Document Server on `127.0.0.1:80` and tokenized storage listener on `127.0.0.1:9100` remain co-located loopback services and must not be replaced by a cross-network fallback.

`ONLYOFFICE_PUBLIC_URL` is provider-owned topology and has no direct-port fallback in OnlyOfficeAgent. The blocking Web Publishing provider emits `http://office.localhost:8081` for local/default workspaces and `https://office.<base-domain>` for managed public workspaces before OnlyOffice starts. Runtime config rejects a missing value. The manifest entry remains non-required and has no default because Ploinky's static profile-completeness rule rejects required non-secret entries without defaults; the runtime requirement is intentionally enforced after provider resolution instead of advertising a dead static URL. Web Publishing must overwrite stale `8082`/`18082` values and preserve the local `:8081` port in `X-Forwarded-Host`.

Document Server request filtering must allow private-address fetches because signed editor configs intentionally point `document.url` and `callbackUrl` at the decorator's co-located `127.0.0.1` storage listener. The OnlyOfficeAgent manifest sets `ALLOW_PRIVATE_IP_ADDRESS=true` for this in-container loopback flow. It must not set `ALLOW_META_IP_ADDRESS`; metadata-address fetches are not required for document storage and must remain blocked.

Writable editor configs must set `editorConfig.customization.autosave=true` and `editorConfig.customization.forcesave=true`; read-only configs keep autosave enabled but set forcesave false. Autosave is the editor-to-Document-Server state, while OnlyOfficeAgent persistence occurs only from trusted save callbacks (`status` 2 or 6) after write permission and download-origin checks. The custom Document Server wrapper must enable `services.CoAuthoring.autoAssembly` before supervisor starts so open editing sessions periodically emit force-save callbacks without requiring the user to close the tab. Operators may tune this with `ONLYOFFICE_AUTO_ASSEMBLY_ENABLED`, `ONLYOFFICE_AUTO_ASSEMBLY_INTERVAL`, and `ONLYOFFICE_AUTO_ASSEMBLY_STEP`.

The same wrapper must set RabbitMQ's `vm_memory_calculation_strategy` to `erlang` before the bundled services start. Nested rootless Podman cannot expose inner process IDs through the outer container's procfs, so RabbitMQ's default `rss` strategy aborts while looking up its process in `/proc`; the Erlang strategy obtains process memory from the VM and allows the bundled Document Server to boot without widening the container's privileges. The Debian init script's `rabbitmqctl wait` PID check has the same procfs incompatibility, so the wrapper starts only the local bundled RabbitMQ daemon with the package's underlying `start-stop-daemon` command and leaves the official Document Server TCP readiness loop as the startup gate. Other local services and remote AMQP configurations keep the upstream startup path.

The wrapper must also default the bundled single-node RabbitMQ node name to `rabbit@localhost`. A nested rootless runtime may map the dynamically assigned inner hostname to the outer container's address in `/etc/hosts`; Erlang then tries to contact epmd at an address outside the inner container even though local epmd is healthy. The stable loopback node name removes that namespace-dependent lookup. An explicit upstream `RABBITMQ_NODENAME` remains authoritative.

Ploinky startup readiness must use the root-level `readiness.sh` container probe, not a plain TCP probe of the decorator control listener. The decorator listeners start before the official Document Server bootstrap completes, so control-port reachability alone is a false positive. The blocking probe requires both the control listener and an exact HTTP `200` response for `/web-apps/apps/api/documents/api.js` through the public editor proxy; redirects and other non-`200` responses remain not ready. That path proves the decorator proxy and the bundled Document Server's Nginx/API surface together.

The router remains the only public control point for authenticated identity and agent-to-agent execution.

## Confidential Persistence Invariant

Confidential Office persistence is router-mediated Tier 1 storage:

- the browser opens a protected OnlyOffice session through the router
- the router verifies the user session and mints a User Delegation Grant only when the session request's `path` query parameter is boundary-contained by `/Confidential`
- the grant is scoped to OnlyOfficeAgent → `dpuAgent` in the same repo for up to the eight-hour Office editing window (the manifest declares the target as `agent:./dpuAgent`, which the router expands to `agent:<repo>/dpuAgent` at mint time)
- OnlyOfficeAgent calls `dpuAgent` by presenting both its Agent Assertion and the stored delegation grant
- the router verifies both and mints the DPU-audience Router Request with the original acting user in signed `usr` claims
- `dpuAgent` evaluates Confidential ACLs for the acting user while preserving OnlyOfficeAgent as the caller for audit

OnlyOfficeAgent must never receive `PLOINKY_MASTER_KEY`, `PLOINKY_DERIVED_MASTER_KEY`, `DPU_MASTER_KEY`, or another agent's secret.

OnlyOfficeAgent stores the User Delegation Grant only server-side in the Office session. The grant may be reused until its expiry for the allowed Confidential tools and scopes of that Office session, but each agent-to-agent call still carries a fresh Agent Assertion and receives a fresh DPU Router Request. Workspace sessions must not receive, store, or forward this grant.

## Explorer Contract

Explorer now depends on OnlyOfficeAgent only through the protected session route:

- `GET /services/onlyoffice/office/session?path=<workspace-or-confidential-path>`

Explorer must not expose anonymous or protected `/services/explorer/office/*` or `/public-services/explorer/office/*` routes once the cutover is complete.

Explorer must enable OnlyOfficeAgent in `global` mode so the Ploinky runtime mounts the workspace root into the agent container. Non-Confidential Office files are then read and written through OnlyOfficeAgent's path-confined workspace store under `PLOINKY_WORKSPACE_ROOT`; Confidential files still route to `dpuAgent` and must never be read from direct disk.

## Disallowed State

The following states are not compliant with this invariant:

- Explorer-owned public Office document or callback routes
- loopback storage routes published through router `httpServices`
- a public editor host that exposes `/coauthoring/CommandService.ashx`, `/ConvertService.ashx`, `/converter`, `/example/*`, `/welcome/*`, `/info/*`, `/internal/*`, or `/healthcheck`
- Confidential Office persistence performed with a plain Agent Assertion and no router-minted user delegation
- save callbacks that fetch a caller-provided URL before checking session write permission and trusted Document Server origin

## Implementation Layout

```text
Browser
  -> router protected /services/onlyoffice/office/session
    -> OnlyOfficeAgent control route
      -> workspace metadata or delegated dpuAgent metadata
      -> signed OnlyOffice config
  -> public OnlyOffice editor host
    -> OnlyOfficeAgent allow-list proxy
      -> Document Server editor assets and /doc/* websocket
Document Server
  -> loopback /internal/document/<token>
  -> loopback /internal/callback/<token>
    -> OnlyOfficeAgent storage router
      -> workspace store OR delegated dpuAgent store
```

## Validation

An acceptable deployment must be able to prove, without printing secrets, that:

- the browser opens Office sessions through `/services/onlyoffice/office/session`
- Explorer no longer exposes `/services/explorer/office/*` or `/public-services/explorer/office/*`
- `/internal/document/<token>` and `/internal/callback/<token>` are reachable only on loopback
- the public editor plane serves `api.js` and `/doc/*` while blocking admin/convert/demo/internal endpoints
- the public editor plane serves the root Office runtime assets required by the stock editor (`/document_editor_service_worker.js`, versioned `plugins.json`, and versioned `themes.json`) while still blocking admin/convert/demo/internal endpoints
- the public editor plane does not forward browser credentials or Ploinky identity headers to Document Server
- the Document Server can fetch the decorator's `127.0.0.1` document URL, while metadata-address fetches remain disabled
- startup readiness requires both the decorator control listener and the proxied Document Server `api.js`, rather than accepting the early control socket alone
- the bundled RabbitMQ uses the stable loopback node name and can reach its local epmd under nested rootless container networking
- writable sessions generate force-save-capable configs and the Document Server has auto-assembly enabled so open documents can persist through status 6 callbacks
- the enabled Explorer dependency graph starts OnlyOfficeAgent in `global` mode so normal workspace files are visible inside the container
- save callbacks reject read-only sessions and untrusted download origins before any fetch
- Confidential Office reads and writes reach `dpuAgent` only through router-mediated user delegation
- a user lacking the DPU ACL is denied even though OnlyOfficeAgent is the caller

### Manifest validator posture

`validate-ploinky-agent` passes with 0 errors and emits two intentional warning types, four warning instances total, that are accepted, not bugs:

- `profiles.{default,dev,prod}.env should be an object when present` — the manifest uses the array-of-`{name,...}` form for `env`, which is the runtime-supported shape used by sibling agents in this workspace; the array form is deliberate.
- `mcp-config.json: missing` — OnlyOfficeAgent exposes no MCP tools of its own; it is a delegated MCP *consumer* of `dpuAgent`, so it ships no `mcp-config.json`. If a future policy requires zero warnings, add an explicit empty `mcp-config.json` (`{ "tools": [] }`); until then the absence is correct and intended.

## Conclusion

OnlyOfficeAgent owns the Office runtime boundary in this workspace. Browser Office traffic, loopback document/callback traffic, and delegated Confidential persistence all terminate there, with the router remaining the only public trust broker for authenticated and agent traffic.
