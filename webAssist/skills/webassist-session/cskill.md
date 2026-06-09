# webassist-session

## Description
Creates and updates site-scoped WebAssist visitor session profile records.

## Input Format
- `promptText` contains a JSON object with:
  - `siteId` (string, required)
  - `sessionId` (string, required)
  - `profileDetails` (string[], optional)
  - `contactInformation` (object, optional)

## Output Format
- Plain text only.
