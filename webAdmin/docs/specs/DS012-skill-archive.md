# DS012 - Skill: archive

## Goal
Archive session and lead records safely instead of deleting them, so active workflows ignore those records while files remain recoverable on disk.

## Mechanism
A **cskill** executed through `MainAgent` when the owner requests archive operations for sessions and/or leads.

## Tool Definition
- **Name**: `archive`
- **Description**: Moves session profile/history files and lead files from active folders to `data/archive/`.
- **Inputs**:
  - `sessionIds` (array of strings, optional when target is `visitors`): one or more session IDs.
  - `target` (string, optional): `all` (default), `session`, `lead`, or `visitors`.

## Output
Plain-text string only:
- success: archive report with counts and per-file status (`Archived`, `Missing`, `Already archived`).
- failure: deterministic error text on input validation failures.

## Execution Logic (Node.js)
1. Parse and validate input payload.
2. Normalize `sessionIds` (unique, non-empty values; not required when target is `visitors`) and `target`.
3. For `target: visitors`, move `data/visitors.log` to `data/archive/visitors.log`.
4. For other targets, for each session ID, build expected active files:
   - Session profile: `sessions/{sessionId}-profile.md`
   - Session history: `sessions/{sessionId}-history.md`
   - Lead: `leads/{sessionId}-lead.md`
5. Move existing files to `archive/sessions/` and `archive/leads/` using filesystem rename operations.
6. Silently skip files that do not exist (not all sessions have history or lead files).
7. Do not overwrite already-archived files.
8. Return a readable summary with totals and paths.
