---
title: DS003-main-behavior
summary: Defines WebAssist skill loading, session interaction, and web chat outcomes.
---

# DS003 Main Behavior

## Introduction

WebAssist lets a routed user load the configured skill context, maintain a bounded interaction session, and use the Web CLI chat surface.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Skill and context loading | WebAssist loads the requested skill and verified runtime context for a session. |
| Session and visitor interaction | WebAssist maintains the session workflow and applies its access boundary to visitor flows. |
| Web CLI chat | The web chat surface sends user messages through the configured agent and returns observable responses. |

### Skill and context loading

A user request identifies a WebAssist session and selected skill. The agent resolves the configured skill and bounded context, then returns the loaded result through its active interface.

### Session and visitor interaction

A session trigger loads or updates the user context, applies the configured session rules, and returns the resulting state or an explicit failure. Visitor behavior remains bounded by the runtime route and session contract.

### Web CLI chat

A user submits a chat message through the web interface. WebAssist routes it through the configured LLMAgent runtime and returns the response without exposing provider credentials or private runtime state.

## Conclusion

WebAssist succeeds when the configured skills, sessions, and chat surface remain consistent with the routed runtime and authorization boundary.
