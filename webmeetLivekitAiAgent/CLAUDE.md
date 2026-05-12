# WebMeet LiveKit AI Agent Guide

## Scope

`webmeetLivekitAiAgent` owns the optional self-hosted LiveKit Agents worker for WebMeet AI participants. It registers with the LiveKit server and accepts explicit dispatch jobs created by `webmeetAgent`.

## Mandatory Reading Order

1. Read the nearest parent `AGENTS.md` for workspace-wide rules.
2. Read `docs/index.html` for the local documentation entry point.
3. Read `docs/specs/matrix.md` and `docs/specs/DS01-ploinky-agent-invariant.md` before changing runtime ownership, manifests, dependencies, LiveKit credentials, or dispatch behavior.
4. Read `../webmeetAgent/docs/specs/DS10-self-hosted-livekit-ai-agents.md` and `../webmeetAgent/docs/specs/DS09-ploinky-runtime-invariants.md` before changing WebMeet-facing AI dispatch behavior.

## Repository Rules

- The DS specifications are the source of truth for local contracts and invariants.
- This agent is optional for WebMeet AI dispatch and may be launched through a `no-wait` manifest edge. It must not block Explorer's default dependency graph.
- Keep the native LiveKit Agents dependency tree in this agent's `package.json`; do not reintroduce a `webmeetAgent/package.json` for the same worker.
- LiveKit API credentials must derive from the shared WebMeet LiveKit derivation identity.
- Update `AGENTS.md` and `CLAUDE.md` together so coding agents receive the same local context.

## Key Paths

- `manifest.json`
- `package.json`
- `server/livekit-agent.mjs`
- `docs/specs/DS01-ploinky-agent-invariant.md`
- `../webmeetAgent/docs/specs/DS10-self-hosted-livekit-ai-agents.md`

## Validation

At minimum, validate syntax for `server/livekit-agent.mjs` and JSON manifests. Runtime validation for this optional worker requires enabling this agent, setting `WEBMEET_LIVEKIT_AGENT_ENABLED=true` for `webmeetAgent`, starting WebMeet, and confirming an admin-dispatched LiveKit `AGENT` participant appears in a room.
