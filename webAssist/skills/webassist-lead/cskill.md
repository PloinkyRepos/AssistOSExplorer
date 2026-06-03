# webassist-lead

## Description
Creates or updates a site-scoped lead after profile match, contact information, and explicit consent are validated.

## Input Format
- `promptText` contains a JSON object with:
  - `siteId` (string, required)
  - `sessionId` (string, required)
  - `profile` (string, required)
  - `mandatoryConditionsSatisfied` (boolean, required true)
  - `matchExplanation` (string, required)
  - `contactInfo` (object, required)
  - `consentGranted` (boolean, required true)
  - `consentText` (string, required)
  - `summary` (string, required)
  - `contactRoute` (string, optional)

## Output Format
- Plain text only.

## Constraints
- Persists only under `data/sites/<siteId>/leads/`.
- Lead id is deterministic: `<sessionId>-lead.md`.
- Does not call the LLM.
