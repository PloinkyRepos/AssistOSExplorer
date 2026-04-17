# DS02 - Storage Architecture

## Summary

`dpuAgent` stores confidential state in a dedicated storage root and keeps metadata, permissions, secret values, and confidential file content in separate files or directories.

## Background / Problem Statement

The DPU domain has conflicting storage requirements. Lists and navigation need lightweight metadata. Permission checks need a canonical access control list (ACL) model. Secret values and confidential file bodies need encrypted persistence. A single flat store would make those responsibilities harder to reason about and easier to misuse.

## Storage Layout

By default, the storage root lives next to the resolved workspace root:

```text
.dpu-storage/
  state.json
  permissions.manifest.json
  secrets.json
  blobs/
  .lock/
```

The layers have separate roles:

- `state.json` stores users, secret metadata, and confidential object metadata
- `permissions.manifest.json` stores canonical principal identities and access control list entries for both users and agents
- `secrets.json` stores encrypted secret values
- `blobs/` stores encrypted confidential file content
- `.lock/` is used by the file lock

Agent capability policy remains outside `permissions.manifest.json`. DPU resolves the target agent manifest from the workspace repository tree when it needs to validate whether an agent principal may receive a secret role such as `read` or `write`.

## Structural Separation

`lib/dpu-store.mjs` does not write storage files directly. It relies on `lib/dpu-store-internal/storage.mjs` for:

- storage root resolution
- state load and save
- permissions manifest load and save
- encrypted secret map handling
- encrypted confidential blob handling
- single-writer coordination through `withFileLock()`

This keeps the domain layer focused on object rules and access control list semantics instead of persistence details.

## Practical Operation

Mutating operations run inside `withLockedState()`. That helper loads `state.json` and `permissions.manifest.json`, executes the requested mutation, and persists only the files whose in-memory state was marked dirty. Confidential file bodies and secret values use their own helpers instead of being embedded in metadata objects.

Storage-root resolution is:

1. `DPU_DATA_ROOT`, if set
2. otherwise a default `.dpu-storage` directory next to the resolved workspace root

Workspace-root resolution is:

1. `DPU_WORKSPACE_ROOT`
2. `ASSISTOS_FS_ROOT`
3. `WORKSPACE_ROOT`
4. `process.cwd()`
