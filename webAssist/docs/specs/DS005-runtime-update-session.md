# DS005 - Runtime Module: update-session

`update-session` owns deterministic session persistence across two separate files.

## Functions
- `updateSessionProfile({ siteId, sessionId, profileDetails, contactInformation })` — writes to `sessions/<sessionId>-profile.md`
- `appendSessionTurn({ siteId, sessionId, userMessage, agentResponse })` — appends to `sessions/<sessionId>-history.md`

## Behavior
- Writes only to the configured site datastore.
- `updateSessionProfile` writes profile details and contact information to the profile file. It does not touch the history file.
- `appendSessionTurn` appends user/agent dialogue entries to the history file. It does not touch the profile file.
- Contact fields are merged with existing contact fields in the profile file.
- History entries are appended after the final response automatically by the runtime.

## Profile File Sections
- `Profile Details`
- `Contact Information`

## History File Sections
- `History`
