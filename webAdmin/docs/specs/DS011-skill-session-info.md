# DS011 - Skill: session-info

## Goal
To display session-level context for a specific visitor session, including profile details and conversation history.

## Mechanism
A **cskill** executed through `MainAgent` when the owner asks for details about a specific `sessionId`.

## Tool Definition
- **Name**: `session-info`
- **Description**: Retrieves profile and conversation history data for one session.
- **Inputs**:
  - `sessionId` (string, required): Target session identifier.
  - `historyLimit` (number, optional): Number of history messages shown in limited mode. Default is 10.
  - `includeFullHistory` (boolean, optional): When true, returns full session history.

## Output
Plain-text string only:
- success: readable report containing session profile list, profile details, and history messages.
- failure: deterministic error text on validation or lookup failure.

## Execution Logic (Node.js)
1. Validate `sessionId` and optional history parameters.
2. Read `data/sessions/{sessionId}-profile.md` when available.
3. Read `data/sessions/{sessionId}-history.md` when available.
4. If both are missing, return `Session not found: {sessionId}`.
5. Return formatted plain text with:
   - profile summary,
   - profile details,
   - history messages (first N by default, or full when requested),
   - raw markdown snapshots for loaded session files.
