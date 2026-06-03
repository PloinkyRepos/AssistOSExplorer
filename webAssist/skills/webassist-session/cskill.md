# webassist-session

## Description
Creates and updates site-scoped WebAssist visitor session records.

## Input Format
- `promptText` contains a JSON object with:
  - `siteId` (string, required)
  - `sessionId` (string, required)
  - `profiles` (string[], optional)
  - `profileDetails` (string[], optional)
  - `contactInformation` (object, optional)
  - `consent` (string, optional)

## Output Format
- Plain text only.

## Constraints
- Persists only under `data/sites/<siteId>/sessions/`.
- Uses the single session file `<sessionId>-history.md`.
- Does not call the LLM.
