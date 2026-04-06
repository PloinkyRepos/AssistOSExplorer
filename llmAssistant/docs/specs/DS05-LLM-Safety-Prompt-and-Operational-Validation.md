# DS05 - LLM Safety, Prompt, and Operational Validation

## Role of This Document

This document defines operational safeguards for prompt shaping, bounded context usage, and repository validation behavior.

## Safety Scope

`llmAssistant` executes model requests that derive outputs from caller-provided context. Prompt construction and clipping must remain bounded and deterministic per tool semantics.

## Operational Requirements

Requirement O1: autocomplete context shall be bounded by internal prefix/suffix/focus clipping limits.

Requirement O2: commit-message prompts shall cap per-diff and total included characters.

Requirement O3: conflict resolution shall run deterministic merge attempt before model fallback.

Requirement O4: empty or malformed helper outputs shall fail explicitly.

Requirement O5: provider credentials shall be loaded from env with optional secrets fallback and never hardcoded in repository sources.

Requirement O6: repository validation shall run through llmAssistant tests under `llmAssistant/tests`.

## Constraints

Constraint R1: uncontrolled prompt growth beyond declared clipping strategy is forbidden.

Constraint R2: changing declared tool contracts is allowed only when contracts, documentation, specifications, and tests are updated together.

Constraint R3: exposing raw sensitive runtime configuration values in tool responses is forbidden.

## Invariants

Invariant G1: prompt shaping remains tool-specific and bounded.

Invariant G2: operational errors remain explicit and caller-visible.

Invariant G3: provider abstraction remains internal to agent runtime.

## Validation Criteria

Validation is satisfied when tools enforce bounded context behavior, deterministic fallback paths execute where defined, declared contracts remain aligned with configuration, and llmAssistant tests pass for code changes.
