# DS004 - Runtime Module: load-context

## Goal
Load dynamic visitor-turn context before execution starts.

## Mechanism
`webAssist/src/runtime/load-context.mjs` runs before `MainAgent.executePrompt(...)`.

## Module Contract
- **Name**: `load-context`
- **Input**:
  - `sessionId` (string, required)
- **Output**:
  - `siteInfo` (array)
  - `profilesInfo` (array)
  - `currentLead` (object)
    - `exists` (boolean)
    - `leadId` (string)
    - `status` (string)
    - `profile` (string)
    - `sessionId` (string)
    - `contactInfo` (object)
    - `summary` (string)
  - `sessionProfile` (object)
    - `profiles` (string[])
    - `profileDetails` (string[])
    - `contactInformation` (object)
  - `combinedSiteInfo` (string)
  - `combinedProfilesInfo` (string)
  - `conversationHistoryText` (string)
  - `sessionProfileText` (string)

## Execution Logic
1. Read markdown files from `data/info/`.
2. Read markdown files from `data/profilesInfo/`.
3. Read and parse `data/sessions/{sessionId}-profile.md` if it exists.
4. Read `data/sessions/{sessionId}-history.md` when present, parse dialogue entries, and format the latest 10 messages into `conversationHistoryText`.
5. Resolve deterministic lead file `data/leads/{sessionId}-lead.md` and parse it when present.
6. Return dynamic context values used by the runtime prompt.

## Session Memory Rule
- `load-context` injects a bounded history excerpt from `{sessionId}-history.md` (latest 10 user/agent messages) through `conversationHistoryText`.
- Full session history remains persisted on disk for audit/admin consumers.
- Session continuity remains anchored in `Profile` and `Profile Details` from `{sessionId}-profile.md`.
- Lead existence and lead metadata are provided through `currentLead` from `{sessionId}-lead.md`.

## Datastore Source
- `load-context` uses the datastore singleton configured at agent startup.
- It does not accept runtime `dataDir` overrides.
