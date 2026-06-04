# DS007 - Skill: webassist-session

`webassist-session` persists visitor session profile memory for the active site.

## Required Input
- `siteId`
- `sessionId`

## Optional Input
- `profiles`
- `profileDetails`
- `contactInformation`
- `consent`

## Guarantees
- Writes only to `data/sites/<siteId>/sessions/<sessionId>-profile.md`.
- Does not modify `<sessionId>-history.md`.
- Uses the runtime `updateSessionProfile` function.
- Does not call the LLM.
