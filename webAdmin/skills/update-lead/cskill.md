# update-lead

## Description
Updates lifecycle state for an existing lead. It is useful when an owner wants to move a lead through the pipeline (`invalid`, `contacted`, `converted`) after review or outreach.

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
