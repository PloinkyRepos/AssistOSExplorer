# DS04 - OnlyOffice Integration

## Summary

This specification describes how `AssistOSExplorer` integrates with the Ploinky-managed OnlyOfficeAgent decorator runtime for Office-style document preview and editing.

## Background / Problem Statement

Explorer must support Office-class documents inside the IDE without owning the security-sensitive editor runtime itself. The implementation must support:

- browser-side editor loading
- authenticated Office session creation
- loopback-only document and callback handling
- workspace file persistence
- Confidential DPU persistence with user ACL enforcement

## Goals

1. Keep Explorer as the IDE shell and preview host.
2. Move Office session/config/document/callback responsibilities into OnlyOfficeAgent.
3. Preserve router-mediated authentication and agent-to-agent policy enforcement.
4. Support both workspace files and Confidential DPU-backed files.
5. Block unnecessary OnlyOffice public endpoints from internet access.

## Non-Goals

- managing Office persistence directly inside Explorer
- exposing anonymous Explorer-owned Office document or callback routes
- using OnlyOffice for `/Confidential/Secrets`
- replacing the native OnlyOffice editor UI with a custom Explorer fork

## Architecture Overview

```text
Explorer preview shell
  -> GET /services/onlyoffice/office/session?path=...
    -> OnlyOfficeAgent control route
      -> workspace store OR delegated dpuAgent metadata
      -> signed OnlyOffice config
  -> browser loads OnlyOffice api.js from OnlyOfficeAgent public editor host
    -> OnlyOfficeAgent allow-list proxy
      -> Document Server assets and /doc/* websocket
Document Server
  -> GET /internal/document/<token>
  -> POST /internal/callback/<token>
    -> OnlyOfficeAgent storage router
      -> workspace disk OR delegated dpuAgent persistence
```

Explorer remains responsible for:

- path selection
- preview state transitions
- loading and error presentation
- re-rendering the surrounding IDE shell

OnlyOfficeAgent owns the Office runtime contract itself.

## Supported File Types

Explorer routes these file types to OnlyOffice:

- `doc`
- `docx`
- `odt`
- `xls`
- `xlsx`
- `ods`
- `csv`
- `ppt`
- `pptx`
- `odp`
- `pdf`

The extension mapping remains implemented in:

- [`services/onlyoffice/onlyoffice-file-types.js`](../services/onlyoffice/onlyoffice-file-types.js)
- [`onlyOffice/src/onlyoffice-config.mjs`](../../onlyOffice/src/onlyoffice-config.mjs)

## API Contract

### Browser Session Route

Explorer opens Office sessions only through:

- `GET /services/onlyoffice/office/session?path=<workspace-or-confidential-path>`

This protected router route is responsible for:

- resolving the selected resource
- verifying the acting user through router-authenticated `x-ploinky-auth-info`
- minting or carrying the router-issued user delegation required for Confidential persistence
- building the browser-facing OnlyOffice config

### Loopback Storage Routes

OnlyOfficeAgent, not Explorer, owns the tokenized storage routes:

- `GET /internal/document/<token>`
- `POST /internal/callback/<token>`

These routes are loopback-only implementation details and must never be published through Explorer or router `httpServices`.

### Public Editor Plane

The browser-visible Office host may expose only the required editor surface:

- `GET /web-apps/apps/api/documents/api.js`
- `GET /web-apps/*`, including OnlyOffice-generated `/<version-hash>/web-apps/*` editor iframe assets
- `GET /document_editor_service_worker.js`
- `GET /<version-hash>/plugins.json`
- `GET /<version-hash>/themes.json`
- `GET /sdkjs/*`
- `GET /sdkjs-plugins/*`
- `GET /fonts/*`
- `GET /themes/*`
- `GET /cache/files/*`
- `GET`/`Upgrade` for `/doc/*`

It must block command, convert, demo, welcome, info, internal, and healthcheck endpoints.

## Behavioral Specification

### Runtime Flow

For a supported file:

1. Explorer requests `GET /services/onlyoffice/office/session?path=...`.
2. OnlyOfficeAgent resolves workspace or Confidential metadata before signing the editor config.
3. OnlyOfficeAgent stores an opaque Office session token.
4. OnlyOfficeAgent signs the OnlyOffice editor config.
5. The browser loads `api.js` from the OnlyOfficeAgent public editor host.
6. Document Server reads through `/internal/document/<token>`.
7. Save callbacks persist through `/internal/callback/<token>`.

Explorer no longer builds Office document URLs or callback URLs and no longer calls `dpuAgent` directly for Office persistence.

OnlyOffice editor autosave is not the same thing as workspace or DPU persistence. The browser editor may show its changes as saved after the Document Server receives them, but OnlyOfficeAgent writes bytes back to the selected storage only when the Document Server calls the loopback callback with a save status (`2` for final save or `6` for force-save). Writable sessions therefore enable `editorConfig.customization.forcesave`, and the OnlyOfficeAgent Document Server wrapper enables `services.CoAuthoring.autoAssembly` so long-lived open editors periodically produce force-save callbacks.

Explorer declares `onlyOffice global` in its `enable[]` dependency list. This is required for the Ploinky container runtime to mount the workspace root at `PLOINKY_WORKSPACE_ROOT` inside OnlyOfficeAgent, which in turn allows the agent's path-confined workspace store to read and write non-Confidential Office files. The `/Confidential` subtree remains excluded from direct disk access and is delegated to `dpuAgent`.

### Client Session Reuse

One user open maps to one Office session. Each `GET /office/session` mints a new server-side session (and, for Confidential paths, consumes a router-minted User Delegation Grant plus `dpuAgent` metadata calls), so Explorer must not re-request a session when nothing changed:

- Explorer caches the in-flight or resolved session per normalized path in the file-exp cache layer; concurrent opens of the same path share one fetch.
- The cached session is reused while the file version hint (listing `modified`/`size`, DPU `updatedAt`) is unchanged — indefinitely while the editor for that session is still mounted, and within a short freshness window (below the agent's session idle TTL) for remounts.
- The cache entry is dropped together with the file-preview cache invalidation for that path, when a different document is opened, or when the fetch fails.
- Editor remount identity is keyed on the signed document identity (`document.key`, title, file type, permissions, mode, user, Document Server URL), never on per-session transport fields (`token`, document/callback URLs). Re-opening an unchanged document keeps the mounted editor iframe; a changed `document.key` (the server derives it from the storage version key) forces a reload.

### Permission Behavior

Workspace files are path-confined and writable only inside the configured workspace root.

Confidential Office permissions come from `dpuAgent` metadata:

- `contentVisible` gates document readability
- `canWrite` controls callback persistence
- `canComment` maps to the editor comment capability

OnlyOfficeAgent must not assume that a router-authenticated user or a stored delegation grant authorizes every DPU operation; `dpuAgent` remains the ACL authority.

The protected Office session response may include browser-safe `preview` metadata (`storageKind`, `requestedPath`, optional `objectId`, `canWrite`, `canComment`) so Explorer can render state without learning callback tokens or DPU delegation tokens.

### Confidential File Support

Confidential Office persistence uses router-mediated user delegation:

- the protected Office session route receives router-verified user auth info
- the router includes a User Delegation Grant only for session requests whose `path` query parameter is boundary-contained by `/Confidential`; the grant is scoped to OnlyOfficeAgent → `agent:<repo>/dpuAgent` after expanding the OnlyOffice manifest's portable `agent:./dpuAgent` target
- OnlyOfficeAgent presents its Agent Assertion plus that grant when calling `dpu_confidential_*`
- the router verifies both and mints the DPU Router Request with the original acting user in signed `usr` claims
- `dpuAgent` stores the resulting bytes encrypted at rest

The User Delegation Grant is a short-lived scoped lease for the Office session. It may be reused for the allowed Confidential tool calls until expiry; each agent-to-agent call still uses a fresh Agent Assertion and receives a fresh DPU Router Request.

Explorer therefore keeps the same IDE experience while moving the persistence boundary out of its own process.

## Configuration

Explorer depends on these environment/runtime assumptions:

- `ONLYOFFICE_PUBLIC_URL`
  Browser-visible editor host URL
- `ONLYOFFICE_INTERNAL_URL`
  Internal Document Server base used when callback download URLs must be rewritten
- `ONLYOFFICE_JWT_SECRET`
  Shared secret used to sign the OnlyOffice editor config

Explorer no longer depends on Explorer-owned public callback/document base URLs because those routes no longer exist.

OnlyOfficeAgent's manifest keeps the protected control listener on container port `7000`, the browser editor proxy on container port `8080`, and the storage listener on loopback port `9100` without publishing any of them. Router-mediated access to a confined listener uses `/base-agent-additional-server/onlyOffice/<container-port>/...`; the storage listener remains unrouted. The legacy `/services/onlyoffice` policy route still describes the authenticated/delegated product boundary and must not be replaced with a public direct-port URL.

The editor proxy must advertise the public origin to the Document Server by forwarding `X-Forwarded-Host` and `X-Forwarded-Proto` on both HTTP and WebSocket upgrade forwards (preserving values set by an outer proxy, otherwise deriving them from the incoming `Host` header and plain `http`). The Document Server builds the browser-facing converted-document cache URLs from these headers, so dropping them strips the public editor port from those URLs and the editor fails with `Download failed.` after the shell loads. See `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md` for the full proxy header contract.

Because signed OnlyOffice configs point the Document Server at the decorator's `127.0.0.1` document and callback URLs, the OnlyOfficeAgent manifest enables `ALLOW_PRIVATE_IP_ADDRESS=true` for the bundled Document Server. It must not enable metadata-address fetches (`ALLOW_META_IP_ADDRESS`) because storage does not need them and they would widen the server-side request surface.

## Operational Constraints

OnlyOffice integration is correct only when all of the following are true:

- OnlyOfficeAgent owns the protected session route
- Explorer no longer declares `/services/explorer/office/` or `/public-services/explorer/office/`
- Explorer enables OnlyOfficeAgent in `global` mode so non-Confidential workspace paths are mounted inside the agent container
- loopback storage routes are not host-published and are not router-routed
- Document Server private-address fetching is limited to the required loopback storage flow, with metadata-address fetching disabled
- the public editor host serves `api.js` and `/doc/*` while blocking admin/convert/demo/internal endpoints
- the public editor host serves the stock editor's root runtime assets (`/document_editor_service_worker.js`, versioned `plugins.json`, and versioned `themes.json`)
- writable sessions are force-save capable and the bundled Document Server has auto-assembly enabled for periodic callback-backed persistence
- Confidential Office persistence re-enters `dpuAgent` only through router-mediated delegation

## Failure And Recovery Expectations

If the Office runtime fails, Explorer should:

- keep the surrounding IDE shell responsive
- surface a document-opening or editor-loading error
- avoid mutating the selected resource unless a verified save callback succeeds
- reject read-only sessions and untrusted callback download origins before fetching callback bytes
- allow the user to reopen the document after auth, connectivity, or delegation expiry recovery

## Known Limitations

- Full end-to-end browser + Document Server smoke coverage requires a live local runtime profile and is not exercised by the default unit test suite.
- Explorer still renders the native OnlyOffice editor UI without project-specific customization.

## Related Specs

- [DS03 - Confidential Files And DPU](./DS03-confidential-files-and-dpu.md)
- [DS06 - Ploinky Runtime Invariants](./DS06-ploinky-runtime-invariants.md)
- [OnlyOffice DS01 - Ploinky Agent Invariant](../../onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md)
