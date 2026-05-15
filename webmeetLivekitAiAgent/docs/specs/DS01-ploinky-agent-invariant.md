# DS01 - Ploinky Agent Invariant

## Summary

The WebMeet LiveKit AI worker is owned by the optional Ploinky-managed `webmeetLivekitAiAgent` agent. WebMeet's base API, public proxy, MCP server, chat, media rooms, and recording controls remain in `webmeetAgent`; the native LiveKit Agents dependency tree belongs only to this separate worker agent.

Status: implemented.

## Core Invariant

Fresh Explorer and WebMeet startup must not require the self-hosted AI worker dependency tree. The worker depends on native LiveKit packages and a larger transitive npm tree than the meeting API needs, so it must not be declared through `webmeetAgent/package.json` and must not run inside `webmeetAgent/scripts/startAgent.sh`.

The `webmeetLivekitAiAgent` manifest owns:

- the `node:24.15.0` runtime for the LiveKit Agents worker
- the worker command `node /code/server/livekit-agent.mjs`
- `readiness.protocol: "none"` because the worker is long-running and does not expose an HTTP or MCP readiness port
- `@livekit/agents`, `@livekit/rtc-node`, and `achillesAgentLib` dependencies through this agent's `package.json`
- the shared WebMeet LiveKit API key and secret derivation labels used by `webmeetAgent`, `webmeetLivekitServer`, and `webmeetLivekitEgress`
- default LiveKit internal URLs for `default`, `dev`, and `prod` profiles, including `WEBMEET_LIVEKIT_AGENT_URL` so the worker can use a topology-specific signaling URL without changing the shared WebMeet API URL
- `WEBMEET_AGENT_API_URL=http://webmeetAgent:8791` in bridge-networked `default` and `dev`, and `WEBMEET_AGENT_API_URL=http://127.0.0.1:18791` in host-networked `prod`, so agent chat and transcript persistence go through the WebMeet API container without exposing a public route
- `WEBMEET_STT_URL=http://webmeetStt:9000/v1/audio/transcriptions` in bridge-networked `default` and `dev`, and `WEBMEET_STT_URL=http://127.0.0.1:19000/v1/audio/transcriptions` in host-networked `prod`, so scribe jobs use the internal WebMeet STT service without operator configuration
- `WEBMEET_AGENT_INTERNAL_TOKEN`, derived with the same shared WebMeet agent-secret identity as `webmeetAgent`, so scribe transcript writes can use the WebMeet internal API without a manual secret

`webmeetAgent/manifest.json` may include the worker through a `no-wait` enable edge so fresh Explorer startup can launch dependency preparation in the background without gating WebMeet readiness. Explorer and WebMeet must remain usable if the background launch is still running or fails.

In the `prod` profile, the worker uses `network.mode: "host"` because production LiveKit also runs on the host network to avoid the WebRTC bridge UDP source-NAT failure. The base `webmeetAgent` prod profile must publish its public proxy and internal API on localhost-only ports so the host-network worker can persist chat and transcript segments while browser and MCP access still goes through Ploinky routing.

When an admin attaches an AI participant, `webmeetAgent` creates LiveKit dispatches for `WEBMEET_LIVEKIT_AGENT_NAME`; this agent must be running with the same name so it can accept those dispatches and appear as a real LiveKit `AGENT` participant.

## Disallowed State

`webmeetAgent/package.json` must not be reintroduced for the LiveKit AI worker. `webmeetAgent/scripts/startAgent.sh` must not import `@livekit/agents`, run `npm install`, or start `server/livekit-agent.mjs`. Any future AI worker dependency changes belong in `webmeetLivekitAiAgent/package.json`.

## Validation

An acceptable runtime validation must prove that:

- `ploinky start explorer` succeeds without waiting for `webmeetLivekitAiAgent`
- dependency wave output for the default Explorer graph does not include a `webmeetAgent` npm install for `@livekit/agents`
- when `webmeetLivekitAiAgent` is launched through the no-wait edge, Ploinky prepares the worker's dependency cache under that agent name and records background status/logs
- an admin attach creates a LiveKit dispatch that is accepted by the worker, and a real LiveKit `AGENT` participant appears with WebMeet attributes for meeting id, agent type, and mode
- an admin scribe attach creates a real LiveKit `AGENT` participant and produces transcript segments from room microphone audio through `webmeetStt`
