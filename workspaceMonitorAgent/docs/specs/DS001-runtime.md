# DS001 - Workspace Monitor runtime

## Runtime

The agent supervises its private telemetry consumer and the standard Ploinky AgentServer. Resource history is stored through `node:sqlite` under the agent's Ploinky persistent storage root, using WAL mode and 13-month retention.

The consumer reads the Router-owned private workspace metrics stream with a generation-bound Private Agent Assertion. It stores every available Agents aggregate, Router, and individual runtime CPU and memory value and writes no more than one value per metric every ten seconds. Individual runtime series use the stable encoded `repoName/agentName` identity, falling back to `containerName` when needed. The four configurable thresholds apply only to the aggregate Agents and Router series; individual runtime history is stored and displayed without thresholds or spike classification.

## Tools

`workspace_monitor_settings_get`, `workspace_monitor_settings_update`, and `workspace_monitor_history_query` require an administrator invocation. Settings replacement is atomic. History requests are limited to the 13-month retention window. `maxPoints` defaults to 600 and is capped at 50,000 points per series; the query selects a time-bucket size that stays within the requested limit. Queries accept the four aggregate series and encoded per-runtime CPU and memory series. Aggregate buckets return their maximum value, the threshold recorded with that maximum for spike classification, and the latest recorded threshold for drawing the threshold timeline. Runtime buckets use the same storage shape with a neutral threshold value that the Resources UI ignores.

Live resource display and audit logs are not proxied through this agent. SQLite history failure must not disable those existing Explorer surfaces.

The history date-time controls default to the latest 24 hours and limit both interval endpoints to the current local time. The UI refreshes that maximum when a picker is opened, clamps a future selection to the current time, and preserves the existing chart when another invalid interval is entered.

The Resources tab uses the existing live status stream and keeps a bounded 300-sample browser buffer for each listed runtime. The first runtime is selected by default; selecting another row displays that runtime's live status, CPU, memory, recent CPU chart, and persisted CPU and memory history for its independently selectable date interval without adding a Ploinky endpoint.
