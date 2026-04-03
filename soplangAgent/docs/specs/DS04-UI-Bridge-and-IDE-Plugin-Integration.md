# DS04 - UI Bridge and IDE Plugin Integration

## Role of This Document

This document defines agent rules for the UI integration role of soplangBuilder, including IDE plugin insertion and MCP communication behavior.

## UI Bridge Position

soplangBuilder exposes UI-facing extension artifacts through `IDE-plugins` and operational APIs through MCP tools. This defines a two-channel bridge. The presentation channel inserts UI components in Explorer host surfaces. The operation channel executes MCP tools against agent contracts.

The bridge must keep concerns separate: UI components trigger agent operations, while tool execution and persistence semantics remain server-side responsibilities.

## Integration Requirements

Requirement U1: IDE plugin artifacts must be discoverable and injectable by host UI systems without requiring private runtime imports.

Requirement U2: UI actions that mutate or inspect workspace state must call MCP tools and must not depend on direct SOPLang runtime binding in browser code.

Requirement U3: long-running operations must expose progress through MCP task-state updates so UI components can represent queued, running, completed, and failed states.

Requirement U4: UI integration must support internal Explorer repository workflows even when there is no public Explorer URL.

Requirement U5: agent-provided UI actions must remain mapped to documented contract operations.

Requirement U6: SOPLang-specific document plugin bundles for variable editing and script execution must remain agent-owned under `soplangAgent/IDE-plugins` so Explorer base UI can stay decoupled from SOPLang implementation details.

## Constraints

Constraint Q1: browser components are not allowed to bypass MCP and call private plugin internals.

Constraint Q2: host UI layout details are not allowed to change backend contract semantics.

Constraint Q3: visual plugin insertion points may evolve, but operation contracts must stay stable.

## Invariants

Invariant P1: UI-to-runtime communication path is MCP-based.

Invariant P2: IDE plugin channel remains optional for agent execution; MCP contracts remain primary integration boundary.

Invariant P3: integration keeps soplangBuilder as intermediary between UI intent and SOPLang runtime operations.

## Validation Criteria

Validation is satisfied when UI plugin actions trigger MCP tools successfully, when task updates are observable for asynchronous operations, when SOPLang-specific bundles (`edit-variables`, `run-script`) are loaded from `soplangAgent/IDE-plugins`, and when backend behavior remains aligned with declared contracts regardless of host UI refactors.
