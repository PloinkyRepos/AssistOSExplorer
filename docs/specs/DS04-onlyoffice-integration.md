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
- protected Office service requests must receive a router-issued invocation token, which Explorer forwards as `X-Ploinky-Caller-JWT` when calling `dpuAgent`.
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
  Shared signing secret used to sign the OnlyOffice editor config. For the Ploinky-managed Document Server, Explorer derives this value with the same `ONLYOFFICE_JWT_SECRET` manifest label used by the Explorer runtime, then starts or recreates the OnlyOffice container with that exact secret. The host preinstall hook can compute the same value from `PLOINKY_DERIVED_MASTER_KEY`, or from `PLOINKY_MASTER_KEY` before the derived key has been injected into a runtime container.

The distinction between public and internal URLs is architectural, not cosmetic. Explorer needs both because the browser and the backend do not necessarily reach OnlyOffice through the same network path.

## Operational Constraints

OnlyOffice integration is correct only when all of the following are true:

- the browser can load `api.js` from `ONLYOFFICE_PUBLIC_URL`
- Explorer can reach the internal document server endpoint when callback processing requires it
- OnlyOffice can reach Explorer's public callback and document routes
- the JWT secret is aligned between Explorer and OnlyOffice
- the selected resource resolves to a supported content class

Explorer does not provision OnlyOffice itself. OnlyOffice must already be available in the target environment, and the `ONLYOFFICE_*` variables must be injected by the surrounding runtime or external orchestration.

`api.js` is provided by the OnlyOffice Document Server itself, not by the Explorer repo.

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
