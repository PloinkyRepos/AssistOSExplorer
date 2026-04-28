# statistics

## Description
Computes session and lead metrics for a requested interval. Typical triggers include `statistics`, `stats`, `metrics`, `report`, `daily stats`, `weekly stats`, `monthly stats`, `yearly stats`, `how many leads`, and `how many sessions`.

## Input Format
- `promptText` contains a JSON object with:
  - `interval` (string, required; `day` | `week` | `month` | `year`)

## Output Format
- Plain-text string only.
- Success returns a readable metrics report (`Interval`, window bounds, totals, and `Leads By Profile`).
- Validation and runtime errors return plain-text error messages.

## Constraints
- Uses filesystem timestamps and parsed lead metadata.
- Does not call the LLM.
