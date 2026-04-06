# DS03 - MCP Tool Contracts and Invocation Lifecycle

## Role of This Document

This document defines contract guarantees and invocation lifecycle rules for `llmAssistant` tools.

## Contract Surface

The public contract consists of three tools: `llm_autocomplete`, `git_commit_message`, and `llm_resolve_conflict`. Each contract has explicit input requirements and bounded output semantics.

## Lifecycle Rules

Lifecycle Rule L1: each invocation starts by parsing MCP envelope input from stdin.

Lifecycle Rule L2: input normalization shall support expected MCP envelope shapes (`input`, `arguments`, and `params` variants).

Lifecycle Rule L3: tool identity resolution shall use `TOOL_NAME` and documented fallback fields.

Lifecycle Rule L4: tool-specific validation shall run before helper execution.

Lifecycle Rule L5: successful results shall return JSON with `ok: true` and tool payload fields.

Lifecycle Rule L6: failures shall return JSON with `ok: false` and explicit error text.

## Failure Semantics

Failure Rule F1: missing or unsupported tool identity fails explicitly.

Failure Rule F2: missing required inputs fail explicitly.

Failure Rule F3: empty model responses fail explicitly.

Failure Rule F4: helper exceptions are surfaced as contract errors, not silent null outputs.

## Constraints

Constraint M1: tool contracts cannot depend on undocumented payload fields.

Constraint M2: unbounded content processing outside clipping strategy is forbidden.

Constraint M3: returning markdown wrappers or explanatory text where plain payload is required is forbidden.

## Invariants

Invariant T1: contract output shape remains explicit for each tool.

Invariant T2: conflict resolution keeps deterministic merge attempt ahead of LLM fallback.

Invariant T3: autocomplete contract returns insertion text semantics, not full-file replacement semantics.

## Validation Criteria

Validation is satisfied when MCP clients can execute all tools with schema-compliant inputs, receive explicit success/error payloads, and observe stable lifecycle behavior across repeated invocations.
