# update-session-profile

## Description
Updates session profile memory with the latest profiling data.

## Input Format
- `promptText` contains a JSON object with:
  - `sessionId` (string, required)
  - `profiles` (string[], optional)
  - `profileDetails` (string[], optional)
  - `contactInformation` (object, optional)

## Output Format
- Plain-text string only.
- Success returns a readable persistence summary for the session profile.
- Validation/runtime failures throw errors with deterministic text messages.

## Constraints
- Persists profile memory through runtime `updateSessionProfile`.
- Runtime appends user/agent history separately after final answer.
- Does not call the LLM.
