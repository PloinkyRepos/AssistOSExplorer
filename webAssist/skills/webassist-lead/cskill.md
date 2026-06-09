# webassist-lead

## Description
Creates or updates a site-scoped lead after profile match and contact information are validated.

## Input Format
- `promptText` contains a JSON object with:
  - `siteId` (string, required)
  - `sessionId` (string, required)
  - `profile` (string, required)
  - `contactInfo` (object, required)

## Output Format
- Plain text only.
