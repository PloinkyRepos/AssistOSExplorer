# DS06 - Explorer-Facing DPU Model

## Summary

This page describes how the DPU domain appears to Explorer. The important point is that Explorer may render DPU records in file-like views, but the underlying contract remains DPU-specific.

## Background / Problem Statement

Explorer needs to present confidential content in a way that users can navigate, preview, comment on, and manage. At the same time, the DPU domain should not collapse back into ordinary filesystem semantics just because the UI looks file-like in places.

## Explorer Boundary

The current contract exposed by `dpuAgent` gives Explorer three virtual confidential roots:

- `/Confidential/My Space`
- `/Confidential/Shared`
- `/Confidential/Secrets`

These roots come from `getWorkspaceRoots()`. They are not directories on disk.

Secrets are represented as DPU secret records. Confidential files and folders are represented as confidential object records. Explorer consumes these records through the DPU tool surface and through the DPU runtime-support plugins rather than through direct filesystem access.

## How Explorer Uses The Model

In the current implementation:

- Explorer can ask DPU for visible secret records and confidential object records
- Explorer can use the returned capability flags such as `canRead`, `canComment`, and `canWrite`
- Explorer permissions flows use the DPU runtime-support modal
- Explorer comments flows use the DPU comments popover plugin

This means Explorer remains the presentation layer, but the DPU agent remains the source of truth for:

- who the current actor is
- which virtual confidential roots exist
- which records are visible
- whether content, comments, and access control list (ACL) details should be materialized

## Practical Boundary

The file-like presentation in Explorer should not be confused with normal workspace persistence. Secret values do not go through ordinary filesystem save flows. Confidential file content is not stored in the regular workspace tree. Access control list updates are DPU operations, not Explorer-local metadata changes.

That boundary is the main reason DPU exists as a separate agent instead of as a thin UI helper inside Explorer.
