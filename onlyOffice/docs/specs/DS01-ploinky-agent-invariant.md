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

The manifest must publish the protected control listener on container port `7000` through an ephemeral localhost host port so the Ploinky `httpServices` route targets `/control/*`. The browser-facing editor proxy on container port `8080` remains a separate host port for the OnlyOffice editor assets and `/doc/*` WebSocket paths. The loopback storage listener on `9100` must not be published.

Published ports: the control listener uses a dynamic loopback host port (`127.0.0.1:0:7000`), but the editor proxy publishes a fixed host port (`127.0.0.1:8082:8080`, dev `127.0.0.1:18082:8080`). Ploinky manifest `ports` are literal and are not env-interpolated, so if `8082` collides on the host the operator must edit the manifest `ports` mapping (and the matching `ONLYOFFICE_PUBLIC_URL`) for that workspace. Making the published editor port env-driven requires Ploinky `ports` templating support and is tracked as a separate ploinky enhancement.

Document Server request filtering must allow private-address fetches because signed editor configs intentionally point `document.url` and `callbackUrl` at the decorator's co-located `127.0.0.1` storage listener. The OnlyOfficeAgent manifest sets `ALLOW_PRIVATE_IP_ADDRESS=true` for this in-container loopback flow. It must not set `ALLOW_META_IP_ADDRESS`; metadata-address fetches are not required for document storage and must remain blocked.

Writable editor configs must set `editorConfig.customization.autosave=true` and `editorConfig.customization.forcesave=true`; read-only configs keep autosave enabled but set forcesave false. Autosave is the editor-to-Document-Server state, while OnlyOfficeAgent persistence occurs only from trusted save callbacks (`status` 2 or 6) after write permission and download-origin checks. The custom Document Server wrapper must enable `services.CoAuthoring.autoAssembly` before supervisor starts so open editing sessions periodically emit force-save callbacks without requiring the user to close the tab. Operators may tune this with `ONLYOFFICE_AUTO_ASSEMBLY_ENABLED`, `ONLYOFFICE_AUTO_ASSEMBLY_INTERVAL`, and `ONLYOFFICE_AUTO_ASSEMBLY_STEP`.

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
