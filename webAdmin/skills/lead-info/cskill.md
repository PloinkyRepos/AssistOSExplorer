# lead-info

## Description
Returns lead details and related session history. Typical triggers include `lead info`, `lead details`, `show lead`, `display lead`, `open lead`, `show lead history`, `lead session`, and `lead context`.

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
