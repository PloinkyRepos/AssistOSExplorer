# gitAgent

MCP agent for Git operations inside a Ploinky workspace.

## Responsibilities

- expose Git actions through `mcp-config.json`
- execute Git commands through `tools/git_tool.sh` and `tools/git_tool.mjs`
- keep repository access constrained to workspace roots
- provide LLM-assisted commit message generation

## Available tools

- repository inspection: `git_info`, `git_status`, `git_repos_overview`, `git_identity`
- diff and ignore inspection: `git_diff`, `git_check_ignore`
- staging workflow: `git_stage`, `git_stage_exact`, `git_unstage`, `git_untrack`, `git_restore`
- conflict workflow: `git_conflict_versions`, `git_checkout_conflict`
- remote workflow: `git_commit`, `git_push`, `git_pull`, `git_stash`, `git_stash_pop`
- support tools: `git_diagnose`, `git_set_identity`, `git_commit_message`

## Runtime

The agent is started through [manifest.json](./manifest.json) with:

```sh
sh /code/scripts/startAgent.sh
```

The start script loads API keys from process env first and then falls back to `.ploinky/.secrets`.

## Environment

Filesystem validation uses these roots when present:

- `ASSISTOS_FS_ROOT`
- `WORKSPACE_ROOT`
- `PLOINKY_WORKSPACE_ROOT`

Optional provider and integration variables:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `MISTRAL_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`
- `SOUL_GATEWAY_API_KEY`

## Notes

- `git_commit_message` depends on the default LLM runtime from `achillesAgentLib`.
- The agent is decoupled from Explorer UI. Explorer or other clients should call Git through MCP, not through shared UI internals.

## Documentation

- [GA01 - Git Agent Overview](./docs/specs/GA/GA01-agent-overview.md)
- [GA02 - Explorer Plugin](./docs/specs/GA/GA02-explorer-plugin.md)
