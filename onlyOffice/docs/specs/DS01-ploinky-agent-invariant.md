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
   - only the required editor assets, including OnlyOffice-generated `/<version-hash>/web-apps/*` iframe assets, and `/doc/*` co-authoring WebSocket paths
- must block command, convert, demo, welcome, info, internal, and healthcheck endpoints from the internet
- must strip browser cookies, `Authorization`, proxy authorization, and caller-supplied `x-ploinky-*` identity headers before forwarding to Document Server

The manifest must publish the protected control listener on container port `7000` through an ephemeral localhost host port so the Ploinky `httpServices` route targets `/control/*`. The browser-facing editor proxy on container port `8080` remains a separate host port for the OnlyOffice editor assets and `/doc/*` WebSocket paths. The loopback storage listener on `9100` must not be published.

The router remains the only public control point for authenticated identity and agent-to-agent execution.

## Confidential Persistence Invariant

Confidential Office persistence is router-mediated Tier 1 storage:

- the browser opens a protected OnlyOffice session through the router
- the router verifies the user session and mints a short-lived User Delegation Grant scoped to OnlyOfficeAgent → `agent:AchillesIDE/dpuAgent`
- OnlyOfficeAgent calls `dpuAgent` by presenting both its Agent Assertion and the stored delegation grant
- the router verifies both and mints the DPU-audience Router Request with the original acting user in signed `usr` claims
- `dpuAgent` evaluates Confidential ACLs for the acting user while preserving OnlyOfficeAgent as the caller for audit

OnlyOfficeAgent must never receive `PLOINKY_MASTER_KEY`, `PLOINKY_DERIVED_MASTER_KEY`, `DPU_MASTER_KEY`, or another agent's secret.

OnlyOfficeAgent stores the User Delegation Grant only server-side in the Office session. The grant may be reused until its expiry for the allowed Confidential tools and scopes of that Office session, but each agent-to-agent call still carries a fresh Agent Assertion and receives a fresh DPU Router Request.

## Explorer Contract

Explorer now depends on OnlyOfficeAgent only through the protected session route:

- `GET /services/onlyoffice/office/session?path=<workspace-or-confidential-path>`

Explorer must not expose anonymous or protected `/services/explorer/office/*` or `/public-services/explorer/office/*` routes once the cutover is complete.

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
- the public editor plane does not forward browser credentials or Ploinky identity headers to Document Server
- save callbacks reject read-only sessions and untrusted download origins before any fetch
- Confidential Office reads and writes reach `dpuAgent` only through router-mediated user delegation
- a user lacking the DPU ACL is denied even though OnlyOfficeAgent is the caller

## Conclusion

OnlyOfficeAgent owns the Office runtime boundary in this workspace. Browser Office traffic, loopback document/callback traffic, and delegated Confidential persistence all terminate there, with the router remaining the only public trust broker for authenticated and agent traffic.
