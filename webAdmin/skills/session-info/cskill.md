# session-info

## Description
Returns profile and conversation context for a specific session ID. It is useful when an owner wants to review visitor progression at session level, with either a bounded history sample or full history.

## Input Format
- `promptText` contains a JSON object with:
  - `sessionId` (string, required)
  - `historyLimit` (number, optional; default 10)
  - `includeFullHistory` (boolean, optional; default false)

## Output Format
- Plain-text string only.
- Success returns a readable report with session profiles, profile details, and history messages.
- Validation and lookup failures return plain-text error messages.

## Constraints
- Reads from `data/sessions/{sessionId}-profile.md` and `data/sessions/{sessionId}-history.md`.
- Default history output is the first 10 messages unless full history is requested.
- Does not call the LLM.
