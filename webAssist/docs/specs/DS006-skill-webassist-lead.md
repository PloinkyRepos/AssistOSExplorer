# DS006 - Skill: webassist-lead

`webassist-lead` creates or updates `leads/<sessionId>-lead.md` inside the active site.

## Required Input
- `siteId`
- `sessionId`
- `profile`
- `mandatoryConditionsSatisfied: true`
- `matchExplanation`
- `contactInfo`
- `consentGranted: true`
- `consentText`
- `summary`
- `contactRoute` optional

## Guarantees
- Rejects missing contact information.
- Rejects missing explicit consent.
- Preserves `Created At` on update and refreshes `Updated At`.
- Stores match explanation, consent evidence, contact route, and summary in Markdown sections.
