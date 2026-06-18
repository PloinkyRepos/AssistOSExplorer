# DS007 - Skill: webassist-session

`webassist-session` persists visitor session profile memory for the active site.

## Required Input
- `siteId`
- `sessionId`

## Optional Input
- `profileDetails`
- `contactInformation`

## Guarantees
- Writes only under `<dataRoot>/sites/<siteId>/`, where the default data root is `<PLOINKY_WORKSPACE_ROOT>/webassist-data`.
- Does not modify `<sessionId>-history.md`.
- Uses the runtime `updateSessionProfile` function.
- Does not call the LLM.
