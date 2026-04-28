# DS002 - webAssist Skills and Behavioral Logic

The **webAssist** agent uses specific skills to manage the conversation flow and data processing.

## Skill Type and Runtime Orchestration
- All webAssist runtime skills are implemented as **cskills** (`cskill.md` + `src/index.mjs`).
- Runtime orchestration instructions are provided through a dedicated system prompt file.
- Skills are discovered and registered by `MainAgent` from `webAssist/skills/`.
- Runtime execution is routed through `MainAgent` (no direct hardcoded skill sequence in `WebAssistAgent`).

## Runtime Modules (Non-skill)
- `load-context` runs before orchestration to gather info/profile/session state and deterministic lead state for the current `sessionId`.
- `update-session` runtime functions are used in two stages:
  - `updateSessionProfile` is invoked by `update-session-profile` cskill during orchestration.
  - `appendSessionTurn` is invoked automatically by runtime after final answer.
- These modules live in `webAssist/src/runtime/` and are not registered as cskills.

## System Prompt: visitor-flow
- **Function**: Coordinates one full visitor turn using the skill allowlist.
- **Allowed Skills**: `create-lead`, `book-meeting`, `update-session-profile`.
- **Guarantee**: Persists profile memory fields (`profiles`, `profileDetails`, `contactInformation`, English persistence fields) through `update-session-profile` before final answer; runtime appends user/agent turn history after final answer.
- **Continuity Rule**: Conversation progression is encoded directly in orchestrator-authored `profileDetails`; runtime does not synthesize flow fields.

## Skill: create-lead
- **Function**: Automatically creates a lead entry in `leads/`, or updates the same entry if it already exists for the same session.
- **Logic**: Triggered when a visitor provides contact information and is identified as "valuable" based on the requirements in `profilesInfo/`. The lead file is keyed by `sessionId`, so repeated qualification updates that same lead record.

## Skill: book-meeting
- **Function**: Initiates the transition to a real-person interaction.
- **Logic**: Runs only when a lead already exists for the current `sessionId`; otherwise it fails with a deterministic error. When allowed, it returns meeting/contact details from `config/`.
