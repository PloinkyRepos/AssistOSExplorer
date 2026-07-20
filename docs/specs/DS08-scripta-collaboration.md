---
id: DS08
title: SCRIPTA Collaboration
status: implemented
owner: achilleside-team
summary: Defines the shared SCRIPTA state module, dedicated Explorer CRDT tools, and WebMeet's canonical event boundary.
---

# DS08 - SCRIPTA Collaboration

## Introduction

SCRIPTA is a shared structured-document collaboration capability hosted by Explorer and controlled in WebMeet through its canonical event boundary.

## Core Content

Pure variant and voting behavior lives in `explorer/shared/document/scripta-state.js`. The reusable tabs, score, reaction, proposal, and optional editing surface lives in `explorer/shared/ui/scripta-variants-view/` and is served through Explorer's existing `/shared/*` whitelist. The shared view uses class-scoped neutral layout containers rather than globally styled page-level elements, so it retains the same visual contract in Advanced Editor and WebMeet. The Advanced Editor plugin and WebMeet provide persistence adapters to that component; the shared component never writes document or room state itself.

Explorer is the sole authority for SCRIPTA Markdown and Automerge state. WebMeet reaches it through router-mediated agent-to-agent calls to the internal-only `scripta_crdt_ensure_folder`, `scripta_crdt_workspace_list`, `scripta_crdt_create`, `scripta_crdt_open`, `scripta_crdt_mutate`, and `scripta_crdt_delete` tools. Every operation on a document uses one cross-process lock identity derived from its canonical workspace path, including the interval in which creation has written the file but has not finished initializing its replicas. Create succeeds only after the Markdown file, canonical Automerge state, and path-free collaboration replica are complete; an ordinary failure removes every artifact created by that call. The mutation tool applies shared SCRIPTA semantics and saves the Markdown within one serialized CRDT transaction. Delete is a prepare/commit operation with rollback: Markdown, canonical Automerge state, and the collaboration replica are staged together until the room attachment update succeeds. A later store instance conservatively restores an expired pending deletion instead of discarding staged content.

Shared SCRIPTA document semantics are implemented once in `explorer/shared/document`. WebMeet stores a safe room projection and document focus, not a separately writable document copy, and has no filesystem/parser fallback.

`webmeet_event_command` is WebMeet's sole mutation boundary for both chat and blackboard UI. Multilingual `/event` and `/robo` text is interpreted by an isolated current Ploinky `MainAgent` executing WebMeet's local `blackboard-event` code skill. Canonical JSON bypasses inference. The Full-chat audit persists only the safe canonical event after interpretation, never the raw natural command that may contain a private workspace reference. WebMeet renders one `scripta-document` widget with document and focused-paragraph modes. Guests may ask RoboTeam to resolve a document title inside the room folder without receiving the workspace tree; workspace paths remain confined and guest projections remain path-free. Participant identities are verified against admitted room members before viewer-vote projection.

Focused paragraph, selected variant, and owner-authorized edit mode are shared room presentation state. A transient debounced blackboard message projects the owner's current draft to read-only viewers while Save remains the single incremental CRDT persistence boundary. Realtime document updates invalidate each receiver's projection; WebMeet then reloads it through the authenticated server boundary so owner-only controls and viewer votes are never copied from the participant who initiated the action.

## Decisions & Questions

### Question #1: Why is the state module under Explorer shared code?

Response:
The state rules are independent of the Advanced Editor and must produce identical winners and active text in the editor, server mutation path, and WebMeet renderer.

## Conclusion

SCRIPTA remains workspace-confined while its pure state rules are shared and its persistence authority is limited to dedicated CRDT operations.
