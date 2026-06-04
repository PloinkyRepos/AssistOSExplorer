# DS004 - Runtime Module: load-context

`loadContext({ siteId, sessionId })` loads the active site's deterministic runtime context.

## Inputs
- `siteId` (required)
- `sessionId` (required)

## Reads
- `info/`
- `profiles/`
- `config/owner.md`
- `config/policy.md`
- `sessions/<sessionId>-profile.md` — session profile state (profiles, profile details, contact info, consent)
- `sessions/<sessionId>-history.md` — conversation transcript (last 10 turns for context)
- `leads/<sessionId>-lead.md`

## Output
The module returns approved site info, target profile markdown, owner rules, policy text, parsed session profile state from the profile file, current lead state, and a bounded latest-history excerpt from the history file.

No cross-site fallback or legacy folder fallback is allowed.
