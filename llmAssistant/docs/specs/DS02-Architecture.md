# DS02 - Architecture

## Role of This Document

This document defines mandatory architecture rules for `llmAssistant` as a Ploinky MCP agent.

## Architectural Boundary

The boundary starts at MCP tool invocation and ends at serialized tool response. Caller UX, editor rendering, and Git UI details remain outside the boundary. LLM prompt and execution orchestration remain inside the agent.

## Architecture Shape

The architecture is composed of contract, wrapper, dispatch, helper-domain, and bootstrap layers.

The contract layer is `mcp-config.json`. The wrapper layer is `tools/llm_tool.sh`. The dispatch layer in `llm_tool.mjs` normalizes envelopes, validates args, and routes tools. Helper-domain layer uses `git-commit-message.js` and `git-resolve-conflict.js` plus autocomplete prompt builder logic. Bootstrap layer in `scripts/startAgent.sh` resolves workspace and provider credentials before AgentServer start.

## Architectural Requirements

Requirement A1: tool declarations shall be configuration-driven and mapped through wrapper dispatch.

Requirement A2: each invocation shall run in isolated process context.

Requirement A3: unsupported tool names shall fail explicitly.

Requirement A4: helper functions shall return plain contract outputs, not provider-specific structures.

Requirement A5: conflict resolver shall attempt deterministic merge before LLM fallback.

Requirement A6: bootstrap must support env-first and secrets-fallback provider loading.

## Constraints

Constraint K1: caller code cannot bypass wrapper and call helper internals directly.

Constraint K2: architecture changes that expose provider internals as MCP contract are forbidden.

Constraint K3: execution paths without input validation are forbidden.

Constraint K4: architecture cannot assume a single provider key as permanent dependency.

## Invariants

Invariant V1: one MCP request maps to one declared tool operation.

Invariant V2: dispatch order remains parse, normalize, validate, execute, respond.

Invariant V3: response payloads stay machine-readable and explicit on errors.

Invariant V4: intermediary role between callers and LLM runtime remains unchanged.

## Architecture Validation Criteria

Architecture validation succeeds when all declared tools execute through wrapper and dispatch layers, deterministic conflict fallback works before model invocation, and callers receive stable contract outputs for unchanged inputs.
