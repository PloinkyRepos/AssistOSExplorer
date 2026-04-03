# DS02 - Architecture

## Role of This Document

This document defines the architecture for soplangBuilder as a Ploinky agent. The architecture description is rule-oriented and focuses on mandatory behavior, constraints, and invariants, independent of low-level implementation details.

## Architectural Boundary

soplangBuilder lives between [Ploinky](https://ploinky.com/) AgentServer MCP routing and [SOPLang](https://assistos-ai.github.io/soplang/) plugin/runtime services. The agent boundary starts at MCP tool invocation and ends at normalized response emission after persistence-safe finalization.

The architecture is intentionally intermediary. UI concerns remain in Explorer/UI systems. SOPLang language semantics remain in SOPLang runtime and plugins. soplangBuilder owns orchestration, contract mapping, and lifecycle guarantees.

## Architecture Shape

The architecture is composed of five logical layers. The contract layer defines tools and schemas in `mcp-config.json`. The invocation layer maps tool names to plugin method calls. The runtime bootstrap layer initializes required plugins and skill bridges for the current call scope. The execution layer performs the target operation. The finalization layer enforces persistence and shutdown guarantees.

Each layer has one agent-level purpose and must not absorb responsibilities from adjacent layers. This separation is mandatory to keep contract behavior stable while allowing internal evolution.

## Architectural Requirements

Requirement A1: MCP tool declaration shall be configuration-driven and shall resolve to one wrapper command entrypoint.

Requirement A2: tool-name to method resolution shall be explicit and deterministic, with unsupported tool names producing attributable failures.

Requirement A3: every invocation shall run in an isolated process lifecycle that performs bootstrap, execution, and finalization in one bounded flow.

Requirement A4: SOPLang and skill-related capabilities shall be registered through plugin contracts, not hardcoded ad-hoc call paths.

Requirement A5: after execution, the architecture shall apply persistence-safe termination behavior before process exit.

Requirement A6: the architecture shall support UI-driven asynchronous tool usage through MCP task behavior without redefining tool semantics.

## Constraints

Constraint K1: direct tool execution that bypasses invocation mapping is forbidden.

Constraint K2: architecture changes that remove the intermediary role and expose raw SOPLang internals to UI clients are forbidden.

Constraint K3: persistence finalization shortcuts that can lose committed workspace changes are forbidden.

Constraint K4: plugin-specific assumptions are not allowed to alter MCP contract semantics for unchanged tool names and inputs.

## Invariants

Invariant V1: a valid tool request always maps to exactly one declared contract operation.

Invariant V2: bootstrap and registration happen per invocation scope; cross-invocation shared mutable plugin state is not an agent guarantee.

Invariant V3: state-changing paths end with persistence-safe closure semantics.

Invariant V4: UI integrations call MCP contracts and do not depend on private SOPLang runtime APIs.

## Architecture Validation Criteria

For unchanged input payloads and unchanged tool configuration in the current repository state, architecture-level behavior remains contract-aligned. Unsupported tool requests fail with explicit error outcomes. State-changing operations survive lifecycle completion. UI clients can trigger the same contract operations independently of internal plugin refactoring.
