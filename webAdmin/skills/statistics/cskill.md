# statistics

## Description
Computes performance metrics for a requested time interval. It is useful when an owner needs quantified reporting about sessions and leads over day/week/month/year windows.

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
