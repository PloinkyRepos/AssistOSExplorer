---
title: DS009-skill-webassist-lead
summary: Defines the DS009-skill-webassist-lead contract for WebAssist.
---

# DS009-skill-webassist-lead

## Introduction

This specification defines the active DS009-skill-webassist-lead contract for WebAssist.

## Core Content

### DS006 - Skill: webassist-lead

`webassist-lead` creates or updates `leads/<sessionId>-lead.md` inside the active site.

### Required Input
- `siteId`
- `sessionId`
- `profile`
- `mandatoryConditionsSatisfied: true`
- `matchExplanation`
- `contactInfo`
- `summary`

### Guarantees
- Rejects missing contact information.
- Preserves `Created At` on update and refreshes `Updated At`.
- Stores match explanation, contact route, and summary in Markdown sections.

## Conclusion

WebAssist must preserve the responsibilities and boundaries stated by this specification.
