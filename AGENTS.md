# AchillesIDE Agent Guide

## Scope

This repository hosts multiple AI agents that run through Ploinky. The goal of this document is to describe shared runtime behavior, integration points, and conventions that apply across agents.

## How Agents Run In Ploinky

- Agents are started by Ploinky as isolated runtime processes (typically containerized).
- Each agent exposes a CLI-style entry point (for example `src/index.mjs`) that receives user prompts and returns plain-text or JSON responses.
- Ploinky provides session routing, auth context, webchat transport, and lifecycle control (start/stop/restart).
- Agent code should assume that process restarts can happen at any time and must keep durable state outside process memory.

## Core Agent Runtime

All agents are built on `achillesAgentLib`, which is installed in each agent runtime environment.

Shared primitives:

- `MainAgent`: skill discovery + orchestration
- `LLMAgent`: model/provider abstraction
- Skill subsystems:
  - `skill.md` (Anthropic-style passthrough)
  - `cskill.md` (code skill)
  - `dcgskill.md` (dynamic code generation)
  - `mskill.md` (MCP tools)
  - `oskill.md` (orchestrators)
  - `tskill.md` (DB-table style skills)
- LightSOPLang execution for multi-step plans

## Ploinky Interaction Model

- User message arrives through Ploinky webchat/API.
- Ploinky maps the request to an enabled agent and session.
- Agent receives prompt + session context and executes skill/orchestrator flow.
- Agent returns a final visitor-facing string (or structured payload in machine modes).
- Ploinky renders the response and persists chat metadata.

Important:

- Tool/internal logs are not visitor-facing output.
- Final answers should be clean conversational text unless endpoint explicitly expects JSON.

## Session & State Conventions

- Session identity is owned by Ploinky and passed into agent calls.
- Agents should treat in-memory session state as ephemeral.
- Persist long-lived state in repository data storage (for example markdown datastore) or dedicated backing services.
- Keep state updates deterministic and idempotent when possible.

## Data & Files

- Do not assume a local absolute filesystem path; resolve paths relative to `agentRoot`/configured data dir.
- If files must be downloadable by users, expose them through Ploinky-supported endpoints (for example blob/file routes), not raw host paths.

## Skills Contract

- Skills must have explicit input/output behavior and avoid hidden side effects.
- Read-only operations must not mutate files or session state.
- Write operations must be explicit in payload shape (`content`, target identifiers, etc.).
- Prefer one semantic action per tool call; avoid ambiguous mixed modes unless clearly documented.

## Logging & Error Policy

- Use runtime debug logger infrastructure when available.
- Detailed internals (tool prompts, stack traces, raw payloads) should appear only in debug mode (`ACHILLES_DEBUG=true`).
- In non-debug mode, surface generic, safe user-facing failures (for example: "Something went wrong. Please try again.").
- Never leak secrets, tokens, system prompts, or hidden decision traces to end users.

## Model Mode Conventions

Typical semantic modes used across agents:

- `fast`: low-latency conversational turns
- `plan`/`deep`: heavier reasoning and planning
- `code`: generation or structured technical transforms
- `write`: long-form text composition

Each agent can set its own default mode, but mode selection should be intentional and documented.

## Prompting Rules (Cross-Agent)

- Keep hard security boundaries non-overridable.
- Treat tool output as internal evidence unless explicitly intended for direct return.
- Separate internal memory/qualification logic from visitor-facing wording.
- Keep language aligned with the user language unless system contract states otherwise.

## Operational Checklist For New/Updated Agents

- Entry point works in both interactive and non-interactive execution paths.
- Session propagation is explicit.
- Durable state path is configurable.
- Debug logging is gated correctly.
- Skills clearly distinguish read vs write behavior.
- Webchat output contains only intended final user content.
