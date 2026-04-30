# DS005 - Runtime Module: update-session

## Goal
Persist the current visitor turn after orchestration completes, so session state is written in one deterministic runtime step.

## Mechanism
`webAssist/src/runtime/update-session.mjs` exposes two runtime functions used by different stages:
- `updateSessionProfile(...)`: called by cskill `update-session-profile` from the active `MainAgent` turn.
- `appendSessionTurn(...)`: called automatically by runtime after each turn using the final visitor response.

## Module Contract
- **Name**: `update-session`
- **Input (`updateSessionProfile`)**:
  - `sessionId` (string, required)
  - `profiles` (string[])
  - `profileDetails` (string[])
  - `contactInformation` (object)
- **Input (`appendSessionTurn`)**:
  - `sessionId` (string, required)
  - `userMessage` (string, required)
  - `agentResponse` (string, required)
- **Output (`updateSessionProfile`)**:
  - `success` (boolean)
  - `sessionId` (string)
  - `sessionProfilePath` (string)
  - `sessionProfile` (object)
- **Output (`appendSessionTurn`)**:
  - `success` (boolean)
  - `sessionId` (string)
  - `sessionHistoryPath` (string)
  - `sessionHistory` (object)

## Execution Logic
1. `updateSessionProfile(...)` merges/de-duplicates `profiles` and `profileDetails`, merges `contactInformation`, and writes `data/sessions/{sessionId}-profile.md`.
2. `appendSessionTurn(...)` reads existing `data/sessions/{sessionId}-history.md` and appends current user/agent entries.

## Continuity Invariant
- `updateSessionProfile(...)` persists `profileDetails` exactly as provided by `update-session-profile` payload (after de-duplication).
- `updateSessionProfile(...)` persists `contactInformation` as structured key-value session memory.
- Runtime appends history via `appendSessionTurn(...)` after final answer.
- On future turns, `load-context` may inject the most recent 10 persisted history messages as a bounded prompt snapshot.
- Conversational continuity is still primarily encoded in `Profile Details` by orchestrator instructions.

## Datastore Source
- `update-session` uses the datastore singleton configured at agent startup.
- It does not accept runtime `dataDir` overrides.
