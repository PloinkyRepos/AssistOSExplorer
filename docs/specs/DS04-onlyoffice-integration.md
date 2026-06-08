# DS04 - OnlyOffice Integration

## Summary

This specification describes how Explorer integrates with OnlyOffice Document Server for Office-style document preview and editing.

Within Explorer, OnlyOffice is the delegated editor for supported Office-style documents. It extends the IDE surface rather than replacing it.

## Background / Problem Statement

Explorer needs to support Office-class documents as part of the IDE experience, but these resources cannot be handled correctly by the normal text or PDF preview flows.

The integration must support:

- browser-side editor loading
- secure session derivation
- document download and callback routes
- support for both local workspace files and DPU-backed Confidential files

## Goals

1. Integrate OnlyOffice as the delegated editor for supported document types
2. Keep Explorer as the surrounding IDE shell
3. Separate browser-facing and server-facing networking concerns
4. Support both workspace and Confidential document sources
5. Make the configuration and runtime constraints explicit

## Non-Goals

- provisioning or managing the OnlyOffice service itself inside Explorer
- reimplementing an Office editor in Explorer
- using OnlyOffice for DPU secrets
- replacing the native OnlyOffice UI with a heavily customized Explorer-specific fork

## Architecture Overview

```text
Explorer preview shell
  -> OnlyOffice session route
    -> Explorer session/config builder
      -> OnlyOffice browser API
        -> tokenized document route
        -> tokenized callback route
          -> Explorer storage bridge
```

Explorer remains responsible for the surrounding IDE experience:

- path selection
- preview state transitions
- loading and error handling
- session derivation
- post-save refresh of the visible resource

## Data Models

### Supported File Types

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

The extension-to-editor mapping is implemented in:

- [`services/onlyoffice/onlyoffice-file-types.js`](../services/onlyoffice/onlyoffice-file-types.js)
- [`utils/server/onlyoffice/file-types.mjs`](../utils/server/onlyoffice/file-types.mjs)

### Session Model

For a supported resource, Explorer derives:

- the resolved target path
- the access policy for the current user
- a short-lived document session token
- the OnlyOffice editor configuration
- public callback and document URLs

This session model is what lets Explorer host the editor while still keeping server-controlled security boundaries.

## API Contracts

### Session Route

Authenticated session route:

- `GET /services/explorer/office/session?path=<workspace-or-confidential-path>`

This route is responsible for:

- resolving the selected resource
- determining permissions
- building the editor configuration
- returning the browser-facing session payload

### Public Tokenized Routes

Tokenized public routes used by OnlyOffice:

- `GET /public-services/explorer/office/document/<token>`
- `POST /public-services/explorer/office/callback/<token>`

The public routes are intentionally token-scoped so OnlyOffice can reach them without a user browser session.

This keeps the browser-facing IDE shell and the server-to-server document flow separated.

## Behavioral Specification

### Runtime Flow

For a supported file, Explorer does not use the normal text or PDF preview flow.

The runtime sequence is:

1. The UI requests `GET /services/explorer/office/session?path=...`
2. Explorer resolves the file and permissions
3. Explorer creates a short-lived session token
4. Explorer builds an OnlyOffice editor config
5. The browser loads `api.js` from the configured Document Server
6. OnlyOffice opens the document through Explorer's public download route
7. OnlyOffice saves back through Explorer's public callback route

### Permission Behavior

Explorer derives the OnlyOffice permissions from the resolved file or session:

- `edit`
- `comment`
- `review`

The config builder is here:

- [`utils/server/onlyoffice/onlyoffice-config.mjs`](../utils/server/onlyoffice/onlyoffice-config.mjs)

For normal workspace files, Explorer currently enables write access by default.

For Confidential files, the permissions come from DPU metadata.

Explorer therefore acts as the policy bridge between the selected IDE resource and the editor capabilities granted to OnlyOffice.

### Confidential File Support

OnlyOffice supports Confidential files stored through DPU.

The storage bridge is implemented in:

- [`utils/server/onlyoffice/onlyoffice-document-store.mjs`](../utils/server/onlyoffice/onlyoffice-document-store.mjs)
- [`utils/server/onlyoffice/onlyoffice-dpu-client.mjs`](../utils/server/onlyoffice/onlyoffice-dpu-client.mjs)

Important behavior:

- DPU access is routed back through Ploinky's router MCP proxy instead of directly dialing another agent container or host-published port.
- protected Office service requests must receive a router-issued invocation token; delegated DPU calls re-enter the router with a DS013 Agent Assertion and are authorized through MCP policy before DPU receives a target-audience Router Request.
- read: DPU content is fetched and decoded for download to OnlyOffice
- save: updated binary content is downloaded from OnlyOffice and stored back to DPU as base64

This allows Office editing to remain part of the same Explorer experience even when the resource is not stored on the local filesystem.

## Configuration

Explorer expects these environment variables:

- `ONLYOFFICE_PUBLIC_URL`
  Browser-visible URL of the Document Server
- `ONLYOFFICE_INTERNAL_URL`
  URL that the Explorer backend uses when it must fetch generated files from OnlyOffice during callback processing
- `ONLYOFFICE_CALLBACK_BASE_URL`
  Public base used to generate Explorer callback and document URLs for OnlyOffice
- `ONLYOFFICE_JWT_SECRET`
  Shared signing secret used to sign the OnlyOffice editor config. Explorer declares this env as a required workspace-scoped generated value. The Ploinky-managed `onlyOffice` agent (`onlyOffice/manifest.json`) declares required `JWT_SECRET` with `varName: "ONLYOFFICE_JWT_SECRET"`, `sharedGeneratedSecret: true` so that Document Server's `JWT_SECRET` and Explorer's `ONLYOFFICE_JWT_SECRET` env entries resolve to the same hex value at runtime without custom derivation fields. Explorer no longer derives this secret in its preinstall hook.

The distinction between public and internal URLs is architectural, not cosmetic. Explorer needs both because the browser and the backend do not necessarily reach OnlyOffice through the same network path.

## Operational Constraints

OnlyOffice integration is correct only when all of the following are true:

- the Document Server is owned by the Ploinky-managed `onlyOffice` agent (see `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`)
- the browser can load `api.js` from `ONLYOFFICE_PUBLIC_URL`
- Explorer can reach the internal document server endpoint when callback processing requires it
- OnlyOffice can reach Explorer's public callback and document routes
- the JWT secret is aligned between Explorer and OnlyOffice
- the selected resource resolves to a supported content class

Explorer does not own the OnlyOffice Document Server lifecycle. The Document Server is provisioned by the `onlyOffice` Ploinky agent. The `ONLYOFFICE_*` variables flow into Explorer either from the deploy workflow (`set_var ONLYOFFICE_PUBLIC_URL ...` and siblings) or from the `onlyOffice` agent's preinstall hook which writes local-dev defaults if the vars are not already set or resolve to an empty value. Explorer's preinstall hook no longer creates, recreates, or mutates the Document Server container.

`api.js` is provided by the OnlyOffice Document Server itself, not by the Explorer repo.
Ploinky TCP readiness for the `onlyOffice` agent is only the startup gate; acceptance validation must still load `api.js` from the configured internal and browser-visible URLs before the Office editor path is considered healthy.

The `onlyOffice` agent must not bind-mount the Document Server image's internal PostgreSQL, RabbitMQ, or Redis data directories in local rootless Podman workspaces. Those services run as image-owned non-root users, and host bind mounts can appear as root-owned directories inside the container, preventing PostgreSQL from initializing and leaving the browser-visible `api.js` endpoint unavailable. The agent may bind-mount the Document Server `log`, `Data`, and `/var/lib/onlyoffice` paths that are part of the Explorer integration contract.

## Failure And Recovery Expectations

If OnlyOffice integration fails, Explorer should:

- keep the surrounding IDE shell responsive
- surface the failure as a document-opening or editor-loading problem
- avoid corrupting the selected resource state
- allow the user to retry after configuration or connectivity recovery

## Known Limitations

- Explorer currently uses the native OnlyOffice editor UI without project-specific customization for plugins, history, force-save controls, or toolbar behavior.
- The UI currently shows the global Explorer loader while a file is opening, but it does not yet show a dedicated inline OnlyOffice spinner during editor bootstrap.
- The editor behavior for features such as multipage view is native OnlyOffice behavior. Explorer does not currently track or persist those UI settings.

## Related Specs

- [DS01 - Explorer System Overview](./DS01-system-overview.md)
- [DS03 - Confidential Files And DPU](./DS03-confidential-files-and-dpu.md)
- [OnlyOffice DS01 - Ploinky Agent Invariant](../../onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md)
