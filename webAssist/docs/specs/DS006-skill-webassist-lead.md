# DS006 - Skill: webassist-lead

`webassist-lead` creates or updates `leads/<sessionId>-lead.md` inside the active site.

## Required Input
- `siteId`
- `sessionId`
- `profile`
- `mandatoryConditionsSatisfied: true`
- `matchExplanation`
- `contactInfo`
- `summary`

## Guarantees
- Rejects missing contact information.
- Preserves `Created At` on update and refreshes `Updated At`.
- Stores match explanation, contact route, and summary in Markdown sections.
