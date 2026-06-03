# DS005 - Runtime Module: update-session

`update-session` owns deterministic session persistence.

## Functions
- `updateSessionProfile({ siteId, sessionId, profiles, profileDetails, contactInformation, consent })`
- `appendSessionTurn({ siteId, sessionId, userMessage, agentResponse })`

## Behavior
- Writes only to the configured site datastore.
- Uses one session file: `sessions/<sessionId>-history.md`.
- Preserves existing `History` while profile sections are replaced.
- Merges explicit contact fields with existing contact fields.
- Appends user/agent dialogue entries after final response.

## Sections
- `Target Profiles`
- `Visitor Profile Summary`
- `Profile Details`
- `Contact Information`
- `Consent`
- `History`
