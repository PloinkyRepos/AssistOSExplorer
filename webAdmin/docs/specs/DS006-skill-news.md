# DS006 - Skill: news

## Goal
To provide the site owner with immediate awareness of recent webAssist activity across leads, session profile-detail updates, and conversation history updates.

## Mechanism
A **cskill** executed through `MainAgent` when queried about recent lead activity.

## Tool Definition
- **Name**: `news`
- **Description**: Returns recent admin news from leads, profile details, and session history, sorted by newest first.
- **Inputs**:
  - `leads` (object, optional)
    - `limit` (number, optional): Maximum number of recent leads to return. Default is 5.
  - `profileDetails` (object, optional)
    - `limit` (number, optional): Maximum number of recent profile detail entries to return. Default is 5.
  - `sessionHistory` (object, optional)
    - `limit` (number, optional): Maximum number of recent session-history messages to return. Default is 5.

Input rule:
- At least one scope object is required.
- Legacy top-level `limit` is not accepted.

## Output
Plain-text string only:
- success: readable multi-section report that may include:
  - `Recent leads`
  - `Recent profile details`
  - `Recent session history messages`
- failure: deterministic error text on input validation failures.

## Execution Logic (Node.js)
1. Parse scoped limits from `leads`, `profileDetails`, and `sessionHistory`.
2. If `leads` is requested, read `data/leads/`, sort by newest timestamp, and select top N.
3. If `profileDetails` is requested, read `data/sessions/*-profile.md`, parse `Profile Details`, sort by newest session-profile file mtime, and select top N.
4. If `sessionHistory` is requested, read `data/sessions/*-history.md`, parse dialogue entries, sort by newest history-file mtime and latest turns first, and select top N.
5. Return a formatted plain-text report with only the requested sections.
