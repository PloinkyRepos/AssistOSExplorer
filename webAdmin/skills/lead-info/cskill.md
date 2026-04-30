# lead-info

## Description
Returns full details for one lead, including related session profile and history context. It is useful when an owner wants to inspect a specific lead before deciding next actions.

## Input Format
- `promptText` contains a JSON object with:
  - `leadId` (string, required)

## Output Format
- Plain-text string only.
- Success returns a readable lead/session report with key fields, contact info, summary, and session/history excerpts.
- Validation and lookup failures return plain-text error messages.

## Constraints
- Resolves the related session from lead data.
- Does not call the LLM.
