# DS009 - Skill: manage-site-info

## Goal
Create, update, or display site information markdown files in `data/info/`.

## Mechanism
A **cskill** executed through `MainAgent` when the owner manages website info.

## Tool Definition
- **Name**: `manage-site-info`
- **Description**: Writes or reads markdown files under `data/info/`.
- **Inputs**:
  - `files` (array, optional): `{ name?, content }` entries for batch writes (name can be derived).
  - `fileName` + `content` (optional): single file write.
  - `fileName` (optional): read a file by name (without `.md`) when `content` is not provided.
  - `readFile` (optional): legacy read alias (without `.md`).
  - `promptText` (optional): source text used for filename derivation when explicit names are missing.

## Output
Plain-text string only:
- read mode: titled file content (`# filename.md` + content)
- write modes: readable created/updated summary text (with bullet lists for multiple files)
- validation/runtime failures: deterministic error text

## Execution Logic (Node.js)
1. If `fileName` (or `readFile`) is provided without write payload, read the file and return content prefixed with the filename.
2. If `files` is provided, write each file (names derived or provided) and return created/updated lists.
3. If `content` is provided, write one file using `fileName` or a derived filename.
4. Content is written exactly as provided.
