# DS01 - Vision

## Role of This Document

This document defines strategic rules for `llmAssistant` as a Ploinky agent that mediates between callers and LLM-backed helper operations.

## Agent Context

`llmAssistant` serves Explorer and peer-agent workflows that need bounded LLM utilities instead of direct provider coupling. The agent is not a generic chat service. It is a contract-oriented helper boundary for autocomplete, commit-message generation, and conflict resolution.

## Vision Direction

The direction is to keep LLM usage behind stable MCP contracts, with clear input requirements and normalized outputs. Provider-specific behavior should remain internal so callers keep a consistent interface.

## Agent Expectations

Expectation E1: callers can invoke the same named tools through MCP regardless of underlying LLM provider.

Expectation E2: helper tools produce deterministic contract shapes for success and failure.

Expectation E3: prompt shaping and context clipping are controlled by the agent, not by UI glue code.

Expectation E4: LLM-assisted operations are bounded in scope and do not become unrestricted runtime execution.

## Requirements

Requirement R1: the agent shall expose a finite MCP tool set for defined helper operations only.

Requirement R2: the agent shall validate required inputs before LLM execution.

Requirement R3: the agent shall preserve intermediary behavior by returning normalized outputs and explicit errors.

Requirement R4: the agent shall keep provider credentials externalized through runtime environment and secrets fallback.

Requirement R5: tool semantics shall remain specialized: autocomplete insertion text, commit message text, and conflict-resolution content.

## Constraints

Constraint C1: exposing raw provider payloads as contract responses is forbidden.

Constraint C2: bypassing tool validation and dispatch flow is forbidden.

Constraint C3: changing existing tool semantics is allowed only when contracts, documentation, specifications, and tests are updated in the same change scope.

Constraint C4: unrestricted prompt execution surfaces outside declared tools are forbidden.

## Invariants

Invariant I1: `llmAssistant` remains an intermediary between MCP callers and LLM runtime.

Invariant I2: MCP tool names are the public contract for the current repository state.

Invariant I3: failures are explicit and serialized as contract errors.

Invariant I4: provider integration details remain internal to the agent boundary.

## Validation Criteria

The agent passes vision validation when callers can execute all declared tools through MCP, outputs remain contract-consistent for unchanged inputs, and provider changes do not require client contract changes.
