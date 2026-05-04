# statistics

## Description
Computes performance metrics for a requested time interval. It is useful when an owner needs quantified reporting about unique visitors, sessions, and leads over day/week/month/year windows.

## Input Format
- `promptText` contains a JSON object with:
  - `interval` (string, required; `day` | `week` | `month` | `year`)

## Output Format
- Plain-text string only.
- Success returns a readable metrics report (`Interval`, window bounds, visitor totals, session/lead totals, conversion rate, and `Leads By Profile`).
- Validation and runtime errors return plain-text error messages.

## Constraints
- `Total Unique Visitors` represents all visitors that entered the website (from `data/visitors.log`), including users that never opened or used chat.
- `Total Sessions` represents chat interactions (session IDs). Users with a session are users that interacted with chat.
- `Visitors Without Chat` should be interpreted as `Total Unique Visitors - Total Sessions` for the same interval.
- If this subtraction is negative (for example repeat chat sessions or cross-interval effects), treat `Visitors Without Chat` as `0` in the owner-facing explanation.
- Uses filesystem timestamps, parsed lead metadata, and append-only visitor events from `data/visitors.log`.
- Does not call the LLM.
