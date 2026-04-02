# DS03 - Confidential Files And DPU

## Summary

This specification describes how Explorer exposes, previews, edits, and mutates Confidential content backed by the DPU agent.

From the Explorer perspective, Confidential content is part of the IDE surface. Users must be able to browse, preview, edit, and manage access-sensitive resources without leaving the Explorer shell.

## Background / Problem Statement

Confidential resources do not live in the local workspace filesystem, but Explorer still has to present them as first-class IDE resources.

That creates a design problem:

- users expect Confidential content to behave like navigable IDE resources
- DPU owns the underlying storage, ACLs, and domain logic
- Explorer must keep a consistent navigation and editing experience without pretending those resources are normal local files

## Goals

1. Present Confidential content as integrated IDE resources
2. Keep DPU as the source of truth for storage, ACLs, and secret semantics
3. Support file-like navigation, preview, editing, upload, and delete flows
4. Support secret-specific behavior under `/Confidential/Secrets`
5. Make permission and concurrency behavior explicit in the Explorer layer

## Non-Goals

- persisting Confidential content through the local filesystem
- treating DPU secrets as generic text files at the storage layer
- moving ACL enforcement into Explorer
- enabling OnlyOffice for secret resources

## Architecture Overview

```text
Explorer IDE shell
  -> virtual Confidential paths
    -> DPU provider
      -> DPU MCP tools
        -> DPU storage and ACL model
```

Explorer owns the visible IDE behavior:

- tree and list integration
- selection, preview, and editing flow
- contextual actions
- refresh and save coordination

DPU owns:

- confidential object storage
- secret storage
- ACL resolution
- domain-level authorization rules

## Data Models

### Virtual Paths

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

### Content Classes

Explorer treats Confidential content as three different classes:

- folders
- files
- secrets

Secrets are not regular files. They are managed through dedicated DPU secret tools and are intentionally excluded from OnlyOffice.

At the Explorer UI layer, secrets still appear as file-like entries in list and tree views so that users get a consistent navigation model across the IDE.

### Secret Model In Explorer

Within `/Confidential/Secrets`:

- each visible item represents one secret
- the displayed item name is the secret key
- the edited or revealed content is the secret value
- `New Secret` creates a key/value secret
- folder creation is not allowed

## API Contracts

### Read Contracts

For Confidential resources, Explorer does not read from the local filesystem.

Instead, it resolves the target through DPU and then uses tools such as:

- `dpu_workspace_roots`
- `dpu_confidential_list`
- `dpu_confidential_get`
- `dpu_secret_list`
- `dpu_secret_get`

Main implementation:

- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)

### Write Contracts

Explorer writes Confidential content through DPU, not through filesystem writes.

Main mutation tools:

- `dpu_confidential_create`
- `dpu_confidential_update`
- `dpu_confidential_delete`
- `dpu_secret_put`

Relevant implementation points:

- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)
- [`services/document/documentFsService.js`](../services/document/documentFsService.js)

### Upload Contracts

Explorer upload into Confidential folders supports both text and binary files.

Upload rules:

- text-like files are stored as plain text content
- binary files are encoded as base64 before calling `dpu_confidential_create`
- `mimeType` is preserved when available

Binary payload preparation happens in:

- `readConfidentialUploadPayload(...)`

This is required so Office and PDF files can later be opened safely without text corruption.

## Behavioral Specification

### Preview Behavior

Behavior summary:

- secrets: preview as managed key/value content
- text-like confidential files: preview as code or text
- Office and PDF files: open through OnlyOffice when supported

The same visible IDE surface must therefore route different Confidential resource classes to different preview behaviors.

### Editing Behavior

There are two editing flows:

- text editing
  Explorer edits the file content directly and writes through `dpu_confidential_update`
- OnlyOffice editing
  Explorer hands the document to OnlyOffice and writes the updated binary back to DPU after callback

The OnlyOffice write-back path stores binary content as base64 plus `mimeType`.

For secrets and DPU-backed resources, Explorer also refreshes live data before edit and validates freshness before save so that multi-user updates do not silently overwrite one another.

### Secret-Specific Behavior

For `/Confidential/Secrets`:

- `New Secret` is a key/value creation flow
- folder creation is disallowed
- secrets open as dedicated secret preview or edit resources
- delete remains secret-aware
- rename must not behave like a normal filesystem rename flow

### Permission Behavior

Explorer reflects DPU permissions in the UI and blocks mutations when not allowed.

Examples:

- upload denied when `canUpload` is false
- delete denied when `canDelete` is false
- permissions modal shown only when the user has write visibility

Relevant code:

- [`web-components/pages/file-exp/file-exp-fs-actions.js`](../web-components/pages/file-exp/file-exp-fs-actions.js)
- [`web-components/pages/file-exp/file-exp-dpu-provider.js`](../web-components/pages/file-exp/file-exp-dpu-provider.js)

Explorer should expose permissions as part of the user experience without taking over ACL ownership from DPU.

## Configuration

Confidential integration depends primarily on:

- Explorer access to `dpuAgent`
- valid DPU authentication context
- OnlyOffice configuration for Office-class Confidential files
- DPU metadata and ACL responses for capabilities

Explorer must treat DPU as the authority for path existence, visibility, and mutation permission.

## Important Constraints

- `/Confidential/Secrets` is a separate storage class and does not support OnlyOffice preview.
- Confidential binary files must not be treated as text during upload or save.
- DPU-backed files are virtual resources. Path existence and listing always depend on DPU responses, not direct filesystem inspection.
- `/Confidential/Secrets` must not allow folder creation and must keep secret-specific creation semantics.

## Failure And Recovery Expectations

If a Confidential resource cannot be read or mutated, Explorer should:

- preserve IDE state where possible
- avoid treating the failure as a normal filesystem inconsistency
- show the DPU-backed error in a user-actionable form
- allow retry after dependency recovery or permission changes

## Related Specs

- [DS01 - Explorer System Overview](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/docs/specs/DS01-system-overview.md)
- [DS02 - Plugin Hosting And Dependencies](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/docs/specs/DS02-plugin-hosting-and-dependencies.md)
- [DS04 - OnlyOffice Integration](/Users/adrianganga/Desktop/devWork/testExplorer/.ploinky/repos/fileExplorer/explorer/docs/specs/DS04-onlyoffice-integration.md)
