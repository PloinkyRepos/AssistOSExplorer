# DS09 - Workspace Monitor

## Summary

Explorer hosts an administrator-only, read-only workspace monitor as a native application plugin. It replaces the standalone Ploinky dashboard UI and the separate DPU audit menu without moving configuration, agent management, plugin management, or Copilot settings. The monitor has no dedicated agent runtime, container, or MCP surface.

## Surface

The `workspace-monitor` application plugin is mounted in `file-exp:account-menu` only for administrators. It opens a dedicated Explorer page in a new browser tab, using the `#workspace-monitor-dashboard` dynamic-page route. It is not a modal. The page contains these tabs, in order:

1. Overview
2. Resources
3. Router Logs
4. Policy Audit
5. DPU Audit

The monitor contains no lifecycle, restart, shell-command, configuration, or mutation controls.
Its stylesheet is component-scoped and must not alter File Explorer directory, file, table, log, or footer presentation. It uses Explorer's shared theme variables (`--bg`, `--surface`, `--text`, `--text-soft`, `--accent`, and `--border`) and must not define a separate hardcoded color palette.

## Data Contracts

- Overview reads the authenticated Ploinky `/status/data` snapshot.
- Resources consumes `/status/data?follow=1` as newline-delimited JSON. Ploinky owns one permanent workspace collector and shares its current samples with all connected clients.
- Router Logs and Policy Audit consume `/dashboard/tail?source=router|policy&lines=<n>&follow=0|1`. The body is the raw log stream, equivalent to `tail -n` or `tail -F`, without cursor or pagination envelopes.
- DPU Audit uses the existing `dpu_audit_list` and `dpu_audit_get` MCP tools.

The browser retains at most 300 resource samples for the visible chart. This display buffer is not persisted and is reset by page reload. Ploinky retains only the latest resource sample in memory and does not create a metrics history store.

## Authorization

Explorer must not mount the plugin for a non-admin user. Ploinky independently requires an authenticated administrator for `/status/data`, `/dashboard`, and `/dashboard/tail`. DPU independently requires `admin` or `security` for audit file access; the workspace monitor itself remains administrator-only.
