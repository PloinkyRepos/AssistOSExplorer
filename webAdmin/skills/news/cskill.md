# news

## Description
Returns newest leads first with compact summary data. Typical triggers include `latest leads`, `recent leads`, `news`, `what is new`, `show newest leads`, `lead updates`, and `recent activity`.

## Input Format
- `promptText` contains a JSON object with:
  - `limit` (number, optional; defaults to 5)

## Output Format
- Plain-text string only.
- Success returns a readable list of recent leads (bullet format with status/profile/timestamp/summary).
- Validation and runtime errors return plain-text error messages.

## Constraints
- Sorts by newest lead timestamp descending.
- Does not call the LLM.
