# webassist-match

## Description
Validates that a visitor matches a configured target profile and that mandatory conditions are satisfied.

## Input Format
- `promptText` contains a JSON object with:
  - `siteId` (string, required)
  - `sessionId` (string, required)
  - `profile` (string, required)
  - `mandatoryConditionsSatisfied` (boolean, required true)
  - `matchExplanation` (string, required)

## Output Format
- Plain text validation result.

## Constraints
- Does not persist state.
- Does not call the LLM.
