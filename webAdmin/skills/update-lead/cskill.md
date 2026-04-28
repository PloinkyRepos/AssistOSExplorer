# update-lead

## Description
Updates the lifecycle status of an existing lead. Typical triggers include `update lead status`, `mark lead`, `set lead status`, `change lead status`, and status intents like `mark as contacted`, `mark as converted`, or `mark as invalid`.

## Input Format
- `promptText` contains a JSON object with:
  - `leadId` (string, required)
  - `newStatus` (string, required; `invalid` | `contacted` | `converted`)

## Output Format
- Plain-text string only.
- Success returns a readable update confirmation with core lead fields.
- Validation and lookup failures return plain-text error messages.

## Constraints
- Rejects unknown lead ids and invalid statuses.
- Does not call the LLM.
