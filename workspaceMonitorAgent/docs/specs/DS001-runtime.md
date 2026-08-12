# DS001 - Workspace Monitor runtime

## Runtime

The agent supervises its private telemetry consumer and the standard Ploinky AgentServer. Resource history is stored through `node:sqlite` under the agent's Ploinky persistent storage root, using WAL mode and 13-month retention.

The consumer reads the Router-owned private workspace metrics stream with a generation-bound Private Agent Assertion. It stores every available Agents and Router CPU and memory value, together with the threshold that applied to that sample, and writes no more than one value per metric every ten seconds. Thresholds classify and display spikes; they do not control persistence.

## Tools

`workspace_monitor_settings_get`, `workspace_monitor_settings_update`, and `workspace_monitor_history_query` require an administrator invocation. Settings replacement is atomic. History requests are limited to the 13-month retention window. `maxPoints` defaults to 600 and is capped at 50,000 points per series; the query selects a time-bucket size that stays within the requested limit. Each bucket returns its maximum value, the threshold recorded with that maximum for spike classification, and the latest recorded threshold for drawing the threshold timeline.

Live resource display and audit logs are not proxied through this agent. SQLite history failure must not disable those existing Explorer surfaces.

The history date-time controls default to the latest 24 hours and limit both interval endpoints to the current local time. The UI refreshes that maximum when a picker is opened, clamps a future selection to the current time, and preserves the existing chart when another invalid interval is entered.
