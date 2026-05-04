# llmAssistant

Model Context Protocol (MCP) agent for lightweight LLM-backed coding helpers.

## Responsibilities

- generate inline autocomplete suggestions
- generate Git commit messages from diffs
- resolve Git conflict chunks with an LLM

## Available tools

- `llm_autocomplete`
- `git_commit_message`
- `llm_resolve_conflict`

All tools are dispatched through [tools/llm_tool.sh](./tools/llm_tool.sh) to [tools/llm_tool.mjs](./tools/llm_tool.mjs).

## Runtime

The agent starts with:

```sh
sh /code/scripts/startAgent.sh
```

The start script prefers process env and falls back to `.ploinky/.secrets` for provider credentials.

## Environment

Workspace roots:

- `ASSISTOS_FS_ROOT`
- `WORKSPACE_ROOT`
- `PLOINKY_WORKSPACE_ROOT`

Supported LLM gateway variables:

- `SOUL_GATEWAY_API_KEY`
- `SOUL_GATEWAY_BASE_URL`

## Notes

- `llm_autocomplete` expects full file content and a cursor offset, then returns only the insertion text.
- `git_commit_message` and `llm_resolve_conflict` are shared helpers that can be reused by Git-oriented user interfaces or agents.

## Documentation

- [DS01 - Vision](./docs/specs/DS01-Vision.md)
