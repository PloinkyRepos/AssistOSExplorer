# book-meeting

## Description
Loads owner meeting configuration text for high-intent visitors.

This skill is invoked by `visitor-flow` when the visitor explicitly requests human contact.

## Input Format
- `promptText` contains a JSON object with:
  - `sessionId` (string, required): the active visitor session identifier.

## Input Source Guidance (for orchestrator)
- `sessionId`: from the turn input payload.
- The skill verifies whether a lead file exists for this `sessionId`.

## Output Format
- `string` containing merged markdown from `data/config/`.

## Output Usage (for orchestrator)
- Merge returned configuration naturally into the visitor-facing response.
- Use this only after explicit user intent to talk/meet/book with a human.

## Error Contract
- If no lead exists for `sessionId`, the skill throws exactly:
  - `the current session user does not have a lead! check if user is qualified for a lead then create it`

## Constraints
- Requires an existing lead for the current `sessionId`.
- Fails when configuration files are missing.
- Does not call the LLM.
