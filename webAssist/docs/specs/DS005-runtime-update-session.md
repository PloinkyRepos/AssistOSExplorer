# DS005 - Runtime Module: update-session

`update-session` owns deterministic session persistence in AKUs.

## Functions
- `updateSessionProfile({ siteId, sessionId, profileDetails, contactInformation })` — updates `ku_sess_<sessionId>` state and metadata.
- `appendSessionTurn({ siteId, sessionId, userMessage, agentResponse })` — records `turn` events in `ku_sess_<sessionId>`.

## Behavior
- Writes only to `$PLOINKY_WORKSPACE_ROOT/webassist-data/sites/<siteId>/.aku/`.
- `updateSessionProfile` writes profile details/contact information to KU state + metadata.
- `appendSessionTurn` appends user/agent turn events. It does not overwrite KU state.
- Contact fields are merged with existing contact fields in the profile file.
- History entries are available through `web_cli_history` and are also used by `loadAkuContext`.
