# DS008 - webAssist Testing

## Goal
To define the current automated test coverage for `webAssist`, including the behavior verified by each test file and the runtime guarantees those tests protect.

## Test Runner
- **Command**: `node --test "webAssist/tests/*.test.mjs"`
- **Folder Runner Script**: `node webAssist/tests/runAll.mjs`
- **Scope**: Unit and integration-style tests for runtime modules, cskills, and agent flow.

### runAll Behavior (`tests/runAll.mjs`)
- Discovers test files only in the current `webAssist/tests/` folder.
- Includes `.js` and `.mjs` files.
- Excludes `helpers.mjs` and `runAll.mjs`.
- Executes discovered files through Node.js test runner (`node --test ...`).

## Test Suites and Covered Cases

### 1) `agent.test.mjs`
- Verifies end-to-end visitor turn handling through `createWebAssistAgent(...).handleMessage(...)`.
- Confirms Achilles library import from `node_modules` via `achillesAgentLib` package resolution.
- Confirms runtime delegation through `MainAgent.executePrompt(...)`, `systemPrompt` usage, and cskill tool routing.
- Verifies lead persistence and session persistence with expected markdown sections and content, including session `Contact Information`.

### 2) `load-context.runtime.test.mjs`
- Verifies loading of `info/` and `profilesInfo/` markdown context.
- Verifies session state parsing for existing and new sessions using profile file memory.
- Verifies deterministic lead state loading for `sessionId` (`currentLead`).
- Verifies session history is not loaded into orchestration context.
- Verifies normalized context payload structure returned by runtime module.

### 3) `update-session.runtime.test.mjs`
- Verifies creation of a session file when absent.
- Verifies appending `User` and `Agent` history entries in order.
- Verifies profile and profile-details list updates with de-duplication.
- Verifies contact information merge and persistence under session profile `Contact Information` section.
- Verifies markdown structure compliance with DS001 headings.

### 4) `profile-flow-synthesis.test.mjs`
- Verifies orchestrator-authored conversation-memory details are persisted in `Profile Details`.
- Verifies continuity across turns is preserved through profile details (without runtime flow synthesis fields).
- Verifies history continues to be persisted on disk while orchestration context loads profile memory only.

### 5) `create-lead.test.mjs`
- Verifies deterministic lead filename generation from `sessionId`.
- Verifies lead file creation with required fields (`Status`, `Profile`, `Session ID`, contact info, summary).
- Verifies update-in-place behavior when the same lead already exists.
- Verifies lifecycle field behavior (`createdAt` retained, `updatedAt` refreshed).

### 6) `book-meeting.test.mjs`
- Verifies successful config aggregation from `data/config/`.
- Verifies deterministic failure when current session has no lead.
- Verifies error behavior when no configuration is available.
- Verifies output contract used by the runtime response phase.

### 7) MCP eval suite
- Located in `webAssist/evalsSuite/mcpMode.test.mjs`.
- Not part of `webAssist/tests/runAll.mjs` default run.

### 8) `get-session-history.mcp.test.mjs`
- Verifies MCP history module returns parsed dialogue entries for an existing `sessionId`.
- Verifies missing session history returns deterministic empty payload (`exists: false`, empty history array).

## Fixture Strategy
- Tests use isolated sandbox data directories and fixture markdown seed content.
- Sandbox fixtures also copy `skills/` and repo `data/` to support strict agent-root discovery and default datastore path resolution.
- AchillesAgentLib is expected to be available via `node_modules` package resolution during test execution.
- Tests must not require external network calls or provider credentials.
