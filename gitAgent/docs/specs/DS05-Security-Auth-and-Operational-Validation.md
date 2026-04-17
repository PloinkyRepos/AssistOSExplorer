# DS05 - Security, Auth, and Operational Validation

## Role of This Document

This document defines mandatory operational safeguards for path policy, auth behavior, and validation routines.

## Security and Auth Scope

`gitAgent` enforces repository path safety and auth-aware remote behavior. The agent accepts tool inputs from Model Context Protocol (MCP) clients, validates path scope, and handles GitHub auth state via device flow and secret-backed token storage.

## Operational Requirements

Requirement O1: allowed filesystem roots shall be derived from `ASSISTOS_FS_ROOT`, `WORKSPACE_ROOT`, and `PLOINKY_WORKSPACE_ROOT` when available.

Requirement O2: repository path arguments shall be rejected when they escape allowed roots.

Requirement O3: remote Git operations shall support token propagation from auth metadata and stored token state.

Requirement O4: GitHub device flow state shall persist under workspace state paths and token material shall remain in dedicated secret storage.

Requirement O4a: `gitAgent/manifest.json` shall declare the agent identity and the maximum secret roles the agent may receive through `permissions.secrets.allowedRoles`.

Requirement O4b: when `gitAgent` stores the GitHub token in DPU secret storage, it shall preserve user ownership on the secret and request only the concrete secret grant needed for remote Git operations. DPU remains responsible for validating that requested role against the agent manifest policy.

Requirement O5: configuration and documentation shall remain aligned with `manifest.json` and `mcp-config.json`.

Requirement O6: repository validation shall run through the Git agent test suite under `gitAgent/tests`.

## Constraints

Constraint R1: introducing implicit auth dependencies outside declared environment and secret channels is forbidden.

Constraint R2: changing declared tool names is allowed only when contracts, documentation, specifications, and tests are updated together.

Constraint R3: weakening path validation behavior for convenience is forbidden.

## Invariants

Invariant G1: path-policy checks remain mandatory before Git execution.

Invariant G2: auth helpers may enrich remote execution, but they do not bypass contract-level validation.

Invariant G3: operational diagnostics remain explicit for MCP consumers.

## Validation Criteria

Validation is satisfied when path escape attempts fail safely, auth workflows remain functional for configured environments, declared tools remain consistent with configuration, and the Git agent tests pass for code changes.
