# DS04 - Explorer Integration and IDE Plugin Channel

## Role of This Document

This document defines integration rules for Explorer-facing usage of `gitAgent` and IDE plugin behavior.

## Integration Position

Explorer is the user interface (UI) host. `gitAgent` is the backend Git intermediary. IDE plugin artifacts in `gitAgent/IDE-plugins/` are the UI extension channel that connects Explorer interactions to Model Context Protocol (MCP) tool calls.

## Integration Requirements

Requirement U1: Explorer-facing UI components shall call `gitAgent` through MCP application programming interfaces (APIs).

Requirement U2: Git operation decisions and execution shall remain in the agent backend, not in UI presenters.

Requirement U3: toolbar plugin integration in slot `file-exp:toolbar` shall remain documented and operational.

Requirement U4: plugin dependency components shall remain declarative through plugin configuration.

Requirement U5: asynchronous operation outcomes shall remain representable in UI state through MCP success and failure payloads.

## Constraints

Constraint Q1: UI components are not allowed to bypass agent contracts and execute shell Git directly.

Constraint Q2: host UI refactors are not allowed to alter backend contract semantics.

Constraint Q3: plugin metadata changes are not allowed to break the declared integration slot without coordinated contract updates.

## Invariants

Invariant P1: communication between Explorer and Git backend remains MCP-based.

Invariant P2: IDE plugin channel remains an integration surface, while tool contracts remain the operational source of truth.

Invariant P3: the intermediary role of `gitAgent` between Explorer intent and Git runtime remains unchanged.

## Validation Criteria

Validation is satisfied when Explorer-triggered plugin actions call `gitAgent` tools successfully, tool outcomes map to UI state transitions, and Git execution behavior remains isolated from frontend internals.
