# Confidential Files and DPU

This document describes how Explorer exposes and mutates Confidential content backed by the DPU agent.

## Virtual paths

Explorer exposes Confidential content under virtual paths:

- `/Confidential`
- `/Confidential/My Space`
- `/Confidential/Shared`
- `/Confidential/Secrets`

These are not normal filesystem paths. They are resolved dynamically through DPU.

In the Explorer UI, `/Confidential/Shared` is displayed with the label `Shared with me`.

Main path helpers live in:

- [`services/dpu/dpuPaths.js`](../services/dpu/dpuPaths.js)
- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)

## Content classes

Explorer treats Confidential content as three different classes:

- folders
- files
- secrets

Secrets are not regular files. They are managed through dedicated DPU secret tools and are intentionally excluded from OnlyOffice.

## Explorer read and preview behavior

For Confidential files, Explorer does not read from the local filesystem.

Instead, it resolves the target through DPU and then calls:

- `dpu_workspace_roots`
- `dpu_confidential_list`
- `dpu_confidential_get`
- `dpu_secret_list`
- `dpu_secret_get`

Main implementation:

- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)

Behavior summary:

- secrets: preview as managed key/value content
- text-like confidential files: preview as code/text
- Office/PDF files: open through OnlyOffice when supported

## Write behavior

Explorer writes Confidential content through DPU, not the filesystem.

Main mutation tools:

- `dpu_confidential_create`
- `dpu_confidential_update`
- `dpu_confidential_delete`
- `dpu_secret_put`

Relevant implementation points:

- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)
- [`services/document/documentFsService.js`](../services/document/documentFsService.js)

## Upload behavior

Explorer upload into Confidential folders now supports both text and binary files.

Upload rules:

- text-like files are stored as plain text content
- binary files are encoded as base64 before calling `dpu_confidential_create`
- `mimeType` is preserved when available

Implementation:

- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)

Binary upload payload preparation happens in:

- `readConfidentialUploadPayload(...)`

This is required so Office and PDF files can later be opened safely without text corruption.

## Editing behavior

There are two editing flows:

- text editing
  Explorer edits the file content directly and writes through `dpu_confidential_update`
- OnlyOffice editing
  Explorer hands the document to OnlyOffice and writes the updated binary back to DPU after callback

The OnlyOffice write-back path stores binary content as base64 plus `mimeType`.

Implementation:

- [`utils/server/onlyoffice/onlyoffice-document-store.mjs`](../utils/server/onlyoffice/onlyoffice-document-store.mjs)

## Permissions

Explorer reflects DPU permissions in the UI and blocks mutations when not allowed.

Examples:

- upload denied when `canUpload` is false
- delete denied when `canDelete` is false
- permissions modal shown only when the user has write visibility

Relevant code:

- [`web-components/pages/file-exp/file-exp-fs-actions.js`](../web-components/pages/file-exp/file-exp-fs-actions.js)
- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)

## Important constraints

- `/Confidential/Secrets` is a separate storage class and does not support OnlyOffice preview.
- Confidential binary files should not be treated as text during upload or save.
- DPU-backed files are virtual resources; path existence and listing always depend on DPU responses, not direct filesystem inspection.

## Debugging tips

If a Confidential file fails to open in OnlyOffice:

1. verify the file exists under `/Confidential/...`
2. verify the user has `contentVisible`
3. verify the user has `canWrite` if editing is expected
4. verify Explorer can reach DPU from inside the container
5. verify Explorer can reach `ONLYOFFICE_INTERNAL_URL`

If upload works but opening fails, the usual causes are:

- incorrect binary encoding on upload
- wrong `mimeType`
- wrong DPU connectivity from the Explorer container
- wrong OnlyOffice callback/download topology
