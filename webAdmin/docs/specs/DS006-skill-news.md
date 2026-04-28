# DS006 - Skill: news

## Goal
To provide the site owner with immediate awareness of the most recent interactions that resulted in new leads.

## Mechanism
A **cskill** executed through `MainAgent` when queried about recent lead activity.

## Tool Definition
- **Name**: `news`
- **Description**: Lists the most recent leads added to the system, sorted by newest first.
- **Inputs**:
  - `limit` (number, optional): The maximum number of recent leads to return. Default is 5.

## Output
Plain-text string only:
- success: readable recent-leads list with one block per lead (`leadId`, `status`, `profile`, `summary`, `createdAt`).
- failure: deterministic error text on input validation failures.

## Execution Logic (Node.js)
1. Read the `data/leads/` directory.
2. Get the file metadata (specifically creation time/mtime) for all lead files.
3. Sort the files descending by time.
4. Take the top `limit` files.
5. Parse their contents to extract the status, profile, and summary.
6. Return the formatted list as readable plain text.
