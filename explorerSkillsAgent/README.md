# explorerSkillsAgent

LLM-backed helper agent intended for Explorer-adjacent skills.

## Current repository contents

This checkout currently contains only:

- [manifest.json](./manifest.json)
- [scripts/startAgent.sh](./scripts/startAgent.sh)

There is no local `mcp-config.json`, plugin bundle, or tool implementation in this folder.

## Runtime

The agent starts with:

```sh
sh /code/scripts/startAgent.sh
```

The start script loads provider credentials from process env first and then falls back to `.ploinky/.secrets`.

## Environment

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `MISTRAL_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`
- `SOUL_GATEWAY_API_KEY`

## Note

Based on the current checkout, this repository acts as a runtime shell for future or external Explorer skills rather than as a fully populated agent implementation.
