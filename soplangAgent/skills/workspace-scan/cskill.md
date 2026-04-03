# workspace-scan

Scan the workspace for markdown documents and summarize SOPLang usage.

## Input Format
Provide a string path for the root. Example:

```
/code
```

If the input is empty, the skill will use `SOPLANG_WORKSPACE_ROOT`, `PLOINKY_CWD`, or `process.cwd()`.

## Output Format
Returns a human-friendly summary with counts for markdown files, documents, and SOPLang commands.
