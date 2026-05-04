# DS005 - Skill: statistics

## Goal
To aggregate visitor, session, and lead metrics over specified time intervals to help the owner gauge site performance.

## Mechanism
A **cskill** executed through `MainAgent` when asked for statistics or reports.

## Tool Definition
- **Name**: `statistics`
- **Description**: Returns numerical summaries of unique visitors, visitors in key windows (interval/day/week), total sessions, total leads, conversion, and leads by category over a specified time interval.
- **Inputs**:
  - `interval` (string): The time interval to report. Allowed values: `day`, `week`, `month`, `year`.

## Output
Plain-text string only:
- success: readable metrics report with `interval`, window bounds, visitor metrics, `totalSessions`, `totalLeads`, conversion rate, and `leadsByProfile` lines.
- failure: deterministic error text on input validation failures.

## Execution Logic (Node.js)
1. Determine the start and end dates based on the requested `interval`.
2. Scan the append-only `data/visitors.log` file. Parse events and count unique visitors, visitors in requested interval, and visitors today/week.
3. Scan the `data/sessions/` directory. Use file timestamps to count sessions within the interval.
4. Scan the `data/leads/` directory. Parse lead files in the interval to calculate `totalLeads` and aggregate `leadsByProfile`.
5. Return the calculated statistics as readable plain text.
