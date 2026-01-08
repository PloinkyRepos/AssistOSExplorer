# git-commit-message

## Summary
Generate a Git commit message from a list of diffs using the configured LLM.

## Input
Accepts either:
- a JSON string, or
- an object `{ diffs: Array<{ repoPath, filePath, diff }> }`.

## Output
Returns a plain string commit message.

## Action
git-commit-message.js

