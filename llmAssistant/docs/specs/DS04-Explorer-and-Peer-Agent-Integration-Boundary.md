# DS04 - Explorer and Peer-Agent Integration Boundary

## Role of This Document

This document defines integration rules for how Explorer and other agents consume `llmAssistant`.

## Integration Position

`llmAssistant` is a backend utility boundary. Explorer and peer agents are callers. The agent owns prompt orchestration and provider abstraction while callers provide structured context and consume normalized results.

## Integration Requirements

Requirement U1: integrations shall call `llmAssistant` through MCP tool contracts.

Requirement U2: caller-side code shall not embed provider-specific request logic as a replacement for these contracts.

Requirement U3: autocomplete flows shall supply file content and cursor offset context explicitly.

Requirement U4: Git helper flows shall use structured diff/conflict inputs and consume plain text outputs.

Requirement U5: integration should preserve caller independence from provider migration events.

## Constraints

Constraint Q1: UI and peer agents cannot bypass MCP and call helper modules directly.

Constraint Q2: integration-specific rendering changes cannot alter backend tool semantics.

Constraint Q3: adding undocumented side-channel inputs as hidden dependencies is forbidden.

## Invariants

Invariant P1: communication path remains MCP-based.

Invariant P2: helper contracts stay reusable for both Explorer and peer-agent consumers.

Invariant P3: intermediary role of `llmAssistant` between callers and LLM runtime remains unchanged.

## Validation Criteria

Validation is satisfied when Explorer and peer agents can consume contracts without provider coupling, and backend tool semantics remain stable for unchanged inputs.
