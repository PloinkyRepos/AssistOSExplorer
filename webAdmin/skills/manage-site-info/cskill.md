# manage-site-info

## Description
Creates, updates, or displays site information markdown files under `data/info/`. Typical triggers include read/show intents (`show site info`, `display website info`, `view info file`, `read site file`), create/write intents (`add site info`, `create website info`, `write info file`, `store website details`), and update/edit intents (`update site info`, `edit website info`, `change info file`).

## Input Format
- `promptText` contains a JSON object with:
- `files` (array of objects, optional):
    - `name` (string, optional) – filename without `.md` (or with `.md`); when omitted, derive from prompt/content
    - `content` (string, required) – markdown content to write
  - `fileName` (string, optional) – file name (without `.md`) used for read or write
  - `content` (string, optional) – content to write; when `fileName` is missing, name is derived from prompt/content
  - `readFile` (string, optional) – legacy alias for read target (without `.md`)
  - `promptText` (string, optional) – raw prompt for name derivation (when no file names are given)

## Output Format
- Plain-text string only.
- Read mode returns titled file content in plain text.
- Write modes return readable created/updated summaries (including bullet lists for multiple files).
- Validation and runtime failures return plain-text error messages.

## Constraints
- Writes content exactly as provided.
- Reads return content with a title line containing the filename.
- Does not call the LLM.
