# DS02 - Architecture

## Role of This Document

This document defines mandatory architecture rules for `gitAgent` as a Ploinky Model Context Protocol (MCP) agent.

## Architectural Boundary

The agent boundary starts at Model Context Protocol (MCP) tool invocation and ends at normalized result emission to MCP clients. Explorer-side rendering, host layout, and interaction concerns remain outside this boundary. Raw Git command execution internals are encapsulated in agent services.

## Architecture Shape

The architecture has a contract layer, wrapper layer, dispatch layer, Git service layer, auth layer, and user interface (UI)-extension layer.

The contract layer declares tools in `mcp-config.json`. The wrapper layer executes `tools/git_tool.sh` for each invocation. The dispatch layer in `git_tool.mjs` parses envelopes, validates arguments, and routes operations. The Git service layer executes subprocess commands with timeout and structured parsing. The auth layer manages GitHub device flow and token storage integration. The UI-extension layer exposes IDE plugin artifacts for Explorer. Dependency installation remains outside the tool boundary and is orchestrated by `ploinky`; the manifest keeps the agent container-backed in the shared tools image and performs only container-local Git availability or package checks before startup.

## Architectural Requirements

Requirement A1: tool declaration shall remain configuration-driven through `mcp-config.json`.

Requirement A2: invocation dispatch shall resolve one tool operation per request and fail explicitly for unsupported tools.

Requirement A3: each invocation shall run in an isolated process lifecycle started from the wrapper script.

Requirement A4: repository path validation shall run before any Git subprocess execution.

Requirement A5: remote operations shall support token fallback from auth context or stored auth state.

Requirement A6: UI integration shall use MCP calls and shall not require private runtime imports from Git services.

Requirement A7: manifest startup configuration shall not duplicate generic Node dependency installation already orchestrated by `ploinky`; it may validate image-provided Git or install Git packages inside a compatible container image at startup.

Requirement A8: Git helper flows that use LLM assistance shall request the Achilles `fast` model explicitly through `executePrompt({ model: "fast" })`; legacy `mode` options are not part of the Achilles invocation contract.

## Constraints

Constraint K1: invocation paths that bypass wrapper parsing and validation are forbidden.

Constraint K2: subprocess execution without timeout guardrails is forbidden.

Constraint K3: architecture changes that move Git execution into Explorer UI are forbidden.

Constraint K4: auth flows that expose raw token values to UI components as persistent state are forbidden.

## Invariants

Invariant V1: one MCP tool request maps to one declared contract operation.

Invariant V2: path-policy enforcement remains active regardless of tool type.

Invariant V3: response payloads remain machine-readable and error-attributable.

Invariant V4: IDE plugin integration remains a client channel, not the source of backend execution semantics.

## Architecture Validation Criteria

Architecture validation succeeds when declared tools execute through the wrapper and dispatcher layers, path constraints are enforced, auth-assisted remote operations behave predictably, and Explorer integration remains decoupled from Git subprocess internals.
