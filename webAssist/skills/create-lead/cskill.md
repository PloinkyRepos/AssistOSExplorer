# create-lead

## Description
Creates or updates a deterministic lead markdown file for a session.

This skill is invoked by `visitor-flow` after qualification, not directly by users.

## Input Format
- `promptText` contains a JSON object with:
  - `sessionId` (string, required)
  - `contactInfo` (object, required): explicit contact fields provided by the visitor (for example `email`, `phone`, `name`).
  - `profile` (string, required): selected primary profile label without `.md` suffix (for example `Developer`).
  - `summary` (string, required): concise English summary of why this visitor is a qualified lead.

## Input Source Guidance (for orchestrator)
- `sessionId`: from the turn input payload.
- `contactInfo`: only from explicit user statements in current/previous conversation context; never inferred.
- `profile`: derived from selected profile file in `profiles` by removing `.md`.
- `summary`: synthesized from profile-relevant facts and conversation progression recorded in `profileDetails`.

## Output Format
- Plain-text string only.
- Success returns a readable lead report (created/updated status, lead identifiers, contact info, summary, and persisted markdown snapshot).
- Validation/runtime failures throw errors with deterministic text messages.

## Constraints
- Lead id must be deterministic from `sessionId`.
- Existing lead must be updated in place.
- Does not call the LLM.
