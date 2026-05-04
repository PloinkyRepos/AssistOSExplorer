# manage-site-info

## Description
Creates, updates, or reads site information markdown files under `data/info/`. It is useful for maintaining the website knowledge base that webAssist uses when answering visitors.

## Input Format
- `promptText` contains a JSON object with:
  - `files` (array of objects, optional):
    - `name` (string) – filename without `.md` (or with `.md`)
    - `content` (string, optional) – markdown content to write; **when omitted, the file is read instead**
  - `fileName` (string, optional) – file name (without `.md`) used for single-file read or write
  - `content` (string, optional) – content to write for a single file; when `fileName` is missing, name is derived from prompt/content
  - `readFile` (string, optional) – legacy alias for single-file read target (without `.md`)
  - `promptText` (string, optional) – raw prompt for name derivation (when no file names are given)

## Usage Modes

### Read a single file
```json
{ "fileName": "assistos_vision" }
```
or
```json
{ "readFile": "assistos_vision" }
```

### Read multiple files (no `content` = read mode)
```json
{
  "files": [
    { "name": "assistos_vision" },
    { "name": "integrated_toolchain" },
    { "name": "research_foundation" }
  ]
}
```

### Write a single file
```json
{
  "fileName": "assistos_vision",
  "content": "# Vision\n..."
}
```

### Write multiple files
```json
{
  "files": [
    { "name": "assistos_vision", "content": "# Vision\n..." },
    { "name": "integrated_toolchain", "content": "# Toolchain\n..." }
  ]
}
```

### Mixed read and write in one call
```json
{
  "files": [
    { "name": "assistos_vision" },
    { "name": "integrated_toolchain", "content": "# Updated\n..." }
  ]
}
```

## Key Rules for the LLM
- **To READ a file:** pass only `{ "name": "filename" }` inside `files`, or use `{ "fileName": "filename" }` alone. Do NOT include `content`.
- **To WRITE a file:** include both `name` and `content` inside `files`, or use `{ "fileName": "...", "content": "..." }`.
- **Never** pass an empty `content` field if you only want to read — omit the field entirely.
- Multiple files can be read in one call by listing them in `files` without `content`.
- Mixed read+write is supported in a single call.

## Output Format
- Plain-text string only.
- Read mode returns titled file content in plain text.
- Write modes return readable created/updated summaries (including bullet lists for multiple files).
- Mixed mode returns read content first, then write summary.
- Validation and runtime failures return plain-text error messages.

## Constraints
- Writes content exactly as provided.
- Reads return content with a title line containing the filename.
- Does not call the LLM.
