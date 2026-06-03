# webassist-site-context

## Description
Reads approved site information, target profiles, owner contact rules, and visitor policy for the active site.

## Input Format
- `promptText` contains a JSON object with:
  - `siteId` (string, required)
  - `sessionId` (string, required)

## Output Format
- Plain text context snapshot.

## Constraints
- Reads only from `data/sites/<siteId>/`.
- Does not call the LLM.
