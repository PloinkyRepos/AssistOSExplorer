# DS09 - Workspace Monitor

## Summary

`workspaceMonitorAgent` owns the administrator-only Workspace Monitor application plugin and its durable resource history. Explorer enables the agent as a no-wait dependency and hosts its plugin as a dedicated browser page. Agent, plugin, Copilot, and general application settings remain in their existing surfaces.

## Surface

The `workspace-monitor` application plugin is mounted in `file-exp:account-menu` only for administrators. It opens `#workspace-monitor-dashboard` in a new browser tab. The page contains Overview, Resources, Router Logs, Policy Audit, and DPU Audit tabs. Overview combines live resource values with complete persisted resource history and administrator-editable reference thresholds.

The UI uses Explorer theme variables and shared controls. The Resources tab lists individual runtimes, selects the first one by default, and displays current CPU and memory, a bounded recent CPU chart, and persisted CPU and memory history for the selected runtime. It does not expose lifecycle, restart, shell-command, agent configuration, plugin configuration, or Copilot controls.

## Collection and storage

Ploinky remains the sole owner of workspace and Router resource collection. It exposes its existing snapshots on the private listener at `GET /api/edge/workspace-metrics?follow=1`. The route admits only a currently enabled agent with a valid Private Agent Assertion bound to the exact method, path, and query. It is not accessible from a browser or the public listener.

The agent stores data in a SQLite database under its Ploinky persistent storage root using the `node:sqlite` implementation included with Node 24. The database uses WAL mode and retains 13 months of samples. Every available aggregate, Router, and individual runtime metric is written at most once every ten seconds. Runtime series use encoded stable `repoName/agentName` identities with a `containerName` fallback. Existing exceedance-only records are migrated into the complete sample table, but historical values that were never collected cannot be reconstructed.

The four reference thresholds are Agents CPU, Agents memory, Router CPU, and Router memory. They draw comparison lines for those aggregate series and are stored with their samples; they do not control persistence and do not apply to individual runtime history. Per-runtime charts show raw history without threshold lines or spike classification. The agent derives Agents by summing the runtime metrics and consumes Ploinky's existing `total` value, whose contract already includes both runtime and Router usage. No Ploinky payload extension is required. Defaults are 80%, 4 GiB, 80%, and 512 MiB respectively. The persisted `workspace.*` series names remain stable for compatibility and contain the Agents aggregate.

## MCP contracts

The agent exposes these administrator-only tools:

- `workspace_monitor_settings_get` reads thresholds.
- `workspace_monitor_settings_update` replaces all four thresholds atomically.
- `workspace_monitor_history_query` accepts ISO `from` and `to`, optional series selection, and a maximum point count capped at 50,000. For each aggregate Agents or Router bucket it returns the maximum recorded value, the threshold recorded with that maximum, and the latest recorded threshold. The first threshold classifies the aggregate peak; the latest threshold draws its threshold timeline. Per-runtime buckets use the same response shape with a neutral threshold value that the Resources UI ignores, so their history has no threshold line or spike classification.

Overview defaults to the latest 24 hours and exposes an always-visible From–To date/time interval instead of preset range filters. Both endpoints are limited to the current local time, future selections are clamped to the present, and other invalid input preserves the existing chart. Changing either valid date/time input closes the native picker and reloads history automatically, without a separate Apply action. History is queried at one-minute resolution where the 50,000-point safety cap permits it. Large intervals use a horizontally scrollable time viewport with minute ticks instead of compressing every sample into the card width, and initially scroll to the latest available sample. The live CPU chart and both persisted history charts render continuous, smooth resource lines and areas over a continuous time axis. History charts expose a labeled vertical value axis and label recorded threshold changes. Above-threshold portions are overlaid as stronger color-coded spike curves, classified against the threshold recorded with each peak and including an interpolated threshold crossing at each edge. Persisted history points are keyboard and pointer selectable and reveal the peak sample's exact local date, time, value, and comparison threshold. Live Overview and Resources data continue to use the authenticated `/status/data` surface. Router and Policy logs continue to use `/dashboard/tail`; DPU Audit continues to use `dpu_audit_list` and `dpu_audit_get`.

## Authorization and failure behavior

Explorer does not mount or route the plugin for non-admin users. Every Workspace Monitor MCP tool independently requires an administrator invocation. Ploinky independently authorizes live browser data and the private agent telemetry stream.

If SQLite history cannot be opened or queried, the live resource and audit tabs remain usable and Overview reports history as unavailable. Persistent data and settings survive agent and container recreation while the Ploinky persistent volume is retained.
