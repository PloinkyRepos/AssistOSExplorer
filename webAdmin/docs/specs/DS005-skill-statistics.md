# DS005 - Skill: statistics

## Goal
To aggregate session and lead metrics over specified time intervals to help the owner gauge site performance.

## Mechanism
A **cskill** executed through `MainAgent` when asked for statistics or reports.

## Tool Definition
- **Name**: `statistics`
- **Description**: Returns numerical summaries of total sessions, total leads, and leads by category over a specified time interval.
- **Inputs**:
  - `interval` (string): The time interval to report. Allowed values: `day`, `week`, `month`, `year`.

## Output
Plain-text string only:
- success: readable metrics report with `interval`, window bounds, `totalSessions`, `totalLeads`, and `leadsByProfile` lines.
- failure: deterministic error text on input validation failures.

## Execution Logic (Node.js)
1. Determine the start and end dates based on the requested `interval`.
2. Scan the `data/sessions/` directory. For this iteration, use file creation/modification times (or parse dates inside if implemented) to count sessions within the interval.
3. Scan the `data/leads/` directory. Parse the files created within the interval to calculate `totalLeads` and aggregate `leadsByProfile`.
4. Return the calculated statistics as readable plain text.
