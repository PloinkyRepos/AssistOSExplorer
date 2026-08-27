---
title: DS002-runtime-and-storage
summary: Defines the manifest, supervisor, private metrics stream, current snapshot, SQLite WAL store, and retention boundary.
---

# DS002 Runtime And Storage

## Introduction

Workspace Monitor runs as a Ploinky agent whose supervisor owns child-process lifecycle and whose persistent storage is mounted through the manifest.

## Core Content

The manifest must start server/supervisor.mjs, declare the workspaceLogs Router access capability, mount persistent storage at /data, and provide WORKSPACE_MONITOR_DATA_ROOT from the mounted path. The supervisor must start the collector, log-maintenance worker, and Ploinky AgentServer and restart the collector or maintenance worker with bounded backoff after an unexpected exit.

The collector must request /api/edge/workspace-metrics?follow=1 with a private Router assertion and consume newline-delimited snapshots. For each accepted snapshot it must atomically replace current-snapshot.json with an allowlisted projection containing only the sampling instant, Router metrics, total metrics, and bounded runtime identity, state, and metrics fields. Current-snapshot writes and historical persistence must use independent bounded retry state. The current snapshot is stale fifteen seconds after its sampling instant.

SQLite must use the resource_samples table, WAL mode, a five-second busy timeout, and a thirteen-month retention window. The legacy resource_exceedances table is migrated into resource_samples and is not a second active store.

Log maintenance must call Ploinky's private log service at startup and at the next UTC day boundary. Workspace Monitor must not create local copies of Ploinky-owned logs.

## Conclusion

The manifest and private Router contracts define how the agent starts, receives data, and retains it.
