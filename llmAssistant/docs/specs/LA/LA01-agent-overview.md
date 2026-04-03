# LA01 - LLM Assistant Overview

## Summary

`llmAssistant` este agentul MCP pentru helper-e LLM reutilizabile în workspace, în special autocomplete, commit message generation și conflict resolution.

## Background / Problem Statement

Explorer și agenții dependenți au nevoie de funcții LLM comune, fără să își implementeze fiecare propriul adapter de provider.

## Goals

1. Să ofere tooluri LLM simple și reutilizabile
2. Să centralizeze accesul la provider credentials
3. Să rămână independent de UI specific

## API Contracts

Tooluri cheie:

- `llm_autocomplete`
- `git_commit_message`
- `llm_resolve_conflict`

## Configuration

Variabile suportate:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `MISTRAL_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`
- `SOUL_GATEWAY_API_KEY`
- `ASSISTOS_FS_ROOT`
- `WORKSPACE_ROOT`
- `PLOINKY_WORKSPACE_ROOT`

## Explorer Integration

Explorer nu montează direct un plugin public pentru `llmAssistant`, dar îl folosește indirect prin alte fluxuri și agenți care cer autocomplete sau rezolvare asistată.
