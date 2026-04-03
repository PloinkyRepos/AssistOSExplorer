# llmAssistant

MCP agent for lightweight LLM-backed coding helpers.

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

Supported provider variables:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `MISTRAL_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`
- `SOUL_GATEWAY_API_KEY`

## Notes

- `llm_autocomplete` expects full file content and a cursor offset, then returns only the insertion text.
- `git_commit_message` and `llm_resolve_conflict` are shared helpers that can be reused by Git-oriented UIs or agents.

## Documentation

- [LA01 - LLM Assistant Overview](./docs/specs/LA/LA01-agent-overview.md)
