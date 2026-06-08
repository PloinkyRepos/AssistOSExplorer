# webassist-lead

## Description
Creates or updates a site-scoped lead after profile match and contact information are validated.

## Input Format
- `promptText` contains a JSON object with:
  - `siteId` (string, required)
  - `sessionId` (string, required)
  - `profile` (string, required)
  - `mandatoryConditionsSatisfied` (boolean, required true)
  - `matchExplanation` (string, required)
  - `contactInfo` (object, required)
  - `summary` (string, required)

## Output Format
- Plain text only.

## Constraints
- Persists only under `data/sites/<siteId>/leads/`.
- Lead id is deterministic: `<sessionId>-lead.md`.
- Does not call the LLM.
