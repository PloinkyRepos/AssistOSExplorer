# DS004 - Runtime Module: load-aku-context

`loadAkuContext({ siteId, sessionId, message })` loads AKU-backed runtime context.

## Inputs
- `siteId` (required)
- `sessionId` (required)
- `message` (used by AKU search input)

## Reads
- `$PLOINKY_WORKSPACE_ROOT/webassist-data/sites/<siteId>/.aku/` runtime context, including:
  - site KU and available profile documents,
  - session KU state metadata,
  - session turn history events,
  - lead KU state.

## Output
Returns:
- `sessionProfile` (contact data and profile details),
- `sessionProfileText`,
- `conversationHistoryText`,
- `currentLead`,
- `akuContextText`.

If AKU is missing, returns a valid “new session” scaffold and no-site-context payload.
