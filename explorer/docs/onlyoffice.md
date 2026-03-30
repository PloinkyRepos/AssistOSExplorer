# OnlyOffice Integration

This document describes how Explorer integrates with OnlyOffice Document Server for Office-style document preview and editing.

## Supported file types

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

## Runtime flow

For a supported file, Explorer does not use the normal text or PDF preview flow.

The runtime sequence is:

1. The UI requests `GET /services/explorer/office/session?path=...`
2. Explorer resolves the file and permissions
3. Explorer creates a short-lived session token
4. Explorer builds an OnlyOffice editor config
5. The browser loads `api.js` from the configured Document Server
6. OnlyOffice opens the document through Explorer's public download route
7. OnlyOffice saves back through Explorer's public callback route

Main implementation points:

- [`services/onlyoffice/onlyoffice-preview-service.js`](../services/onlyoffice/onlyoffice-preview-service.js)
- [`services/onlyoffice/onlyoffice-editor-host.js`](../services/onlyoffice/onlyoffice-editor-host.js)
- [`utils/server/onlyoffice/onlyoffice-http-routes.mjs`](../utils/server/onlyoffice/onlyoffice-http-routes.mjs)
- [`utils/server/onlyoffice/onlyoffice-config.mjs`](../utils/server/onlyoffice/onlyoffice-config.mjs)

## Routes

Authenticated session route:

- `GET /services/explorer/office/session?path=<workspace-or-confidential-path>`

Tokenized public routes used by OnlyOffice:

- `GET /public-services/explorer/office/document/<token>`
- `POST /public-services/explorer/office/callback/<token>`

The public routes are intentionally token-scoped so OnlyOffice can reach them without a user browser session.

## Configuration

Explorer expects these environment variables:

- `ONLYOFFICE_PUBLIC_URL`
  Browser-visible URL of the Document Server. Example: `http://127.0.0.1:8082`
- `ONLYOFFICE_INTERNAL_URL`
  URL that the Explorer backend uses when it must fetch generated files from OnlyOffice during callback processing. In containerized local development this should usually be `http://host.containers.internal:<port>`.
- `ONLYOFFICE_CALLBACK_BASE_URL`
  Public base used to generate Explorer callback and document URLs for OnlyOffice. In local containerized development this is typically `http://host.containers.internal:8080`.
- `ONLYOFFICE_JWT_SECRET`
  Shared signing secret used to sign the OnlyOffice editor config.

## Permissions

Explorer derives the OnlyOffice permissions from the resolved file/session:

- `edit`
- `comment`
- `review`

The config builder is here:

- [`utils/server/onlyoffice/onlyoffice-config.mjs`](../utils/server/onlyoffice/onlyoffice-config.mjs)

For normal workspace files, Explorer currently enables write access by default.

For Confidential files, the permissions come from DPU metadata.

## Confidential file support

OnlyOffice supports Confidential files stored through DPU.

The storage bridge is implemented in:

- [`utils/server/onlyoffice/onlyoffice-document-store.mjs`](../utils/server/onlyoffice/onlyoffice-document-store.mjs)
- [`utils/server/onlyoffice/onlyoffice-dpu-client.mjs`](../utils/server/onlyoffice/onlyoffice-dpu-client.mjs)

Important behavior:

- read: DPU content is fetched and decoded for download to OnlyOffice
- save: updated binary content is downloaded from OnlyOffice and stored back to DPU as base64

## Runtime expectations

Explorer does not provision OnlyOffice itself.

OnlyOffice must already be available in the target environment, and the `ONLYOFFICE_*` variables must be injected by Ploinky or by external orchestration.

`api.js` is provided by the OnlyOffice Document Server itself, not by the Explorer repo.

## Known limitations

- Explorer currently uses the native OnlyOffice editor UI without project-specific customization for plugins, history, force-save controls, or toolbar behavior.
- The UI currently shows the global Explorer loader while a file is opening, but it does not yet show a dedicated inline OnlyOffice spinner during editor bootstrap.
- The editor behavior for features such as multipage view is native OnlyOffice behavior; Explorer does not currently track or persist those UI settings.
