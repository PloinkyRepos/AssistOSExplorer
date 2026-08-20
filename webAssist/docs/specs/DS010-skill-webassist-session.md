---
title: DS010-skill-webassist-session
summary: Defines the DS010-skill-webassist-session contract for WebAssist.
---

# DS010-skill-webassist-session

## Introduction

This specification defines the active DS010-skill-webassist-session contract for WebAssist.

## Core Content

### DS007 - Skill: webassist-session

`webassist-session` persists visitor session profile memory for the active site.

### Required Input
- `siteId`
- `sessionId`

### Optional Input
- `profileDetails`
- `contactInformation`

### Guarantees
- Writes only to `$PLOINKY_WORKSPACE_ROOT/webassist-data/sites/<siteId>/.aku/`.
- Does not write legacy session markdown files.
- Uses the runtime `updateSessionProfile` function.
- Does not call the LLM.

## Conclusion

WebAssist must preserve the responsibilities and boundaries stated by this specification.
