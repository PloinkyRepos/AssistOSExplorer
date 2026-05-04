# archive

## Description
Archives session and lead records, and optionally the `visitors.log` file, instead of deleting them. It is useful when an owner wants to hide old or invalid interactions from active workflows while keeping recoverable files in `data/archive/`.

## Input Format
- `promptText` contains a JSON object with:
  - `sessionIds` (array of strings, optional when target is `visitors`; supports one or more session IDs)
  - `target` (string, optional; `all` | `session` | `lead` | `visitors`; default `all`)

## Output Format
- Plain-text string only.
- Success returns a readable archive report with archived and already-archived files.
- Files that do not exist are silently skipped.
- Validation errors return plain-text error messages.

## Constraints
- Moves files from active folders into `data/archive/sessions/` and `data/archive/leads/`, and moves `data/visitors.log` into `data/archive/visitors.log` when target is `visitors`.
- `visitors.log` is an append-only JSON-lines file containing one event per unique visitor (timestamp, visitorId).
- Never deletes files permanently.
- Does not call the LLM.
