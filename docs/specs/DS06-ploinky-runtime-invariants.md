---
id: DS06
title: Ploinky Runtime Invariants
status: implemented
owner: achilleside-team
summary: Captures the Ploinky routing, authentication, guest, secure-wire, sandbox, and documentation invariants that must remain in local context when changing this agent.
---

# DS06 - Ploinky Runtime Invariants

## Introduction

This specification makes the Ploinky runtime and security invariants local to `AssistOSExplorer`. Future work from inside this agent directory must not rely on external memory of Ploinky core behavior; the local specs must carry the same high-level constraints that Ploinky defines in its routing and security model.

The authoritative upstream contracts are Ploinky `docs/specs/DS005-routing-and-web-surfaces.md` and `docs/specs/DS011-security-model.md`. This file restates only the invariants that affect this agent's implementation and documentation.

## Core Content

`AssistOSExplorer` must treat the Ploinky router as the browser and MCP trust broker. Browser surfaces, first-party MCP calls, delegated MCP calls, uploads, blobs, and manifest-declared HTTP services are expected to enter through the router so route authentication, session handling, invocation minting, and audit behavior can apply. Direct agent ports are implementation details even when they are bound to localhost.

Agent MCP sessions are ephemeral runtime state. Ploinky clients should close sessions with `DELETE /mcp` when done, and the shared `AgentServer` may reap idle sessions defensively. Idle cleanup must not close sessions that still have an open HTTP response, because long-running tool calls and SSE streams remain active until their response finishes.

Executable MCP operations must be authorized by router-minted request JWTs. The launcher/router may derive per-agent request secrets from `PLOINKY_MASTER_KEY`, but the agent runtime must receive only its own `PLOINKY_AGENT_ID`, `PLOINKY_AGENT_SECRET`, and compatibility `PLOINKY_AGENT_PRINCIPAL`. Agents must never receive, derive, or require `PLOINKY_MASTER_KEY` or the legacy `PLOINKY_DERIVED_MASTER_KEY`. Code must not invent alternate bearer-token, client-secret, or caller-header authorization paths around the router's secure-wire model.

Ploinky-owned generated secrets are resolved by the launcher before agent code runs. Agent-owned generated secrets use `generatedSecret: true` for manifest env entries or `{{generatedSecret:NAME}}` for runtime-resource templates; both are scoped to the current agent identity and ignore operator-supplied values. Shared generated credentials that must be identical across agents use `sharedGeneratedSecret: true` and derive from the source env name. Agents consume the resolved values but do not hold the master derivation key. Agents must not invent random persistent agent secrets or require manual configuration for workspace-owned LiveKit, TURN, OnlyOffice, DPU, recording, webhook, or data-encryption secrets. External third-party credentials remain explicitly configured.

Ploinky profiles must be complete for non-sensitive topology and runtime configuration. Required URLs, hostnames, public IPs, realms, ports, and similar ordinary config must have profile defaults so a fresh workspace can run `ploinky profile prod` and `ploinky start <agent>` without manual `ploinky var` setup. Secrets, tokens, API keys, passwords, encryption keys, and `generatedSecret` entries remain secret-owned. Workspace vars are still valid overrides for changing hosts or domains. For Soul Gateway consumers, a generated `SOUL_GATEWAY_API_KEY` is marked with `PLOINKY_ENV_SOURCE_SOUL_GATEWAY_API_KEY=generated` and routes through the Ploinky HTTP service. Explorer deployments must treat that local Soul Gateway as the reference gateway and the LLM hub; it does not delegate to a remote gateway. Explorer-started generated gateway credentials must not use `explicitOverride`, because a stale or explicit `SOUL_GATEWAY_API_KEY` would bypass the local gateway. The Soul Gateway Settings button in Explorer opens the local protected dashboard at `/services/soul-gateway/management/` directly through the plugin `settingsUrl`; Explorer must not host a separate Soul Gateway settings modal.

Explorer's `default` profile must use `basic/web-publishing` as the sole public topology owner. Local, QA, and production launches must consume that same Explorer profile wiring instead of defining Explorer-specific `qa` or `prod` profile blocks. Web Publishing must run as a blocking startup config provider before Explorer's public-facing dependencies consume OnlyOffice or WebMeet public URLs, hostnames, callback bases, media IPs, TURN hosts, or TURN peer allow-lists. Local/default output must replace retired direct OnlyOffice ports with `ONLYOFFICE_PUBLIC_URL=http://office.localhost:8081` through Web Publishing's loopback Nginx listener; OnlyOffice must not invent its own browser URL. Coturn derives its realm from the canonical TURN hostname; Web Publishing does not emit a separate realm value. Public deployments must provide an explicit `WEB_PUBLISHING_TLS_EDGE`, `WEB_PUBLISHING_LIVEKIT_MEDIA_IP`, and `WEB_PUBLISHING_TURN_EXTERNAL_IP`; downstream agents must not invent fallbacks. `webmeetAgent`, `liveKitServerAgent`, and `turnServerAgent` form a blocking readiness chain. Deployment workflows must clear stale downstream topology and retired health/static-TURN vars before startup and must not route Explorer deployment profiles through the standalone `basic/cloudflared` agent. Managed QA/production workflows must reject Cloudflare API mode rather than imply they apply external tunnel/DNS mutations, and must enforce a canonical lowercase DNS base domain, bare unicast/non-loopback media and TURN IPv4 inputs, and the mode/TLS-edge contract (`nginx` with `external`; accepted token modes with `cloudflare`) before remote mutation. Before shutdown or repository/start work, they must validate the operator-owned TURN certificate/key under `.ploinky/data/webmeetTls/turn/`; every accepted public mode must also require `turn.<base-domain>` to resolve only to the explicit TURN external IPv4 and have no `AAAA` record. An unexpected IPv6 DNS lookup error must fail closed because it prevents the workflow from proving the IPv4-only endpoint has no IPv6 address. DNS resolution cannot prove Cloudflare proxy status, so the operational contract still requires a DNS-only record. After startup, both managed workflows must require `WEBMEET_PUBLIC_LIVEKIT_URL` to equal exactly `wss://meet.<base-domain>`; they must not reinterpret a downgraded or altered value. They must verify the canonical hostname's exact `/rtc` signaling route with a bodyless WebSocket-upgrade request that returns LiveKit's expected unauthenticated `401` before reporting success.

The compact `x-ploinky-auth-info` header is not a secure grant by itself. Any HTTP service that receives that header must trust it only when it arrived through a declared Ploinky HTTP service route and, for guest services, only after validating the router-issued invocation token and the expected guest role or scope. Caller-supplied copies of identity headers must be rejected as authoritative input.

`x-ploinky-user-delegation` is even narrower: the router must strip it from external requests, and agent code must treat it as meaningful only on verified agent-to-agent MCP calls where the router has already authenticated the source agent. Browser traffic, generic public HTTP requests, and loopback document/callback routes must never accept that header as an authorization source. Delegated-user tool access remains narrower than a normal authenticated browser call because the grant is source-bound, target-bound, tool-bound, scope-bound, and short-lived; it may be reused within those bounds until expiry, while per-call Agent Assertions and Router Requests remain replay-protected.

Guest access must remain scoped to the route shape declared by the owning manifest. Manifest-level `guest: true` exposes the agent as a normal guest agent and should still enforce limitations from `usr.roles`. A `routerAccess.httpRoutes` entry with `access: "guest"` exposes only the declared agent-owned HTTP path and mints or reuses a route-scoped guest session according to the Ploinky router's current guest policy. An `httpServices` entry with `access: "guest"` exposes only the declared HTTP prefix and mints or reuses a service-scoped guest session. Product-specific public paths must be declared in the agent manifest rather than hard-coded in Ploinky core.

Agent code must enforce its own domain authorization. Ploinky route authentication identifies the caller and signs the invocation, but it does not grant every domain operation. Sensitive actions must check the verified user, roles, scopes, target resource, workspace path, and agent-local policy before reading or mutating state.

For the OnlyOffice integration specifically, the internal document and callback routes are loopback-only implementation details, not router routes. They must rely only on the opaque Office session token and local listener binding, never on browser cookies or `x-ploinky-auth-info`. Public editor proxy requests must strip browser cookies, authorization headers, proxy authorization headers, and caller-supplied `x-ploinky-*` identity headers before forwarding to Document Server.

Manifest `openPorts` declarations are outer Ploinky-box publication claims and must be reserved for sockets intentionally eligible to cross that boundary. OnlyOffice declares none: its protected control listener uses private profile `additionalServerPort: "7000"`, its editor proxy is reached by Web Publishing over `office-publishing`, and its storage listener remains on loopback. `webmeetStt` also declares no `openPorts`; it stays on its isolated default network and declares an in-container readiness script for private port `9000`. Direct or blocking STT launches use that script as fail-closed readiness, while Explorer's intentional `webmeetStt no-wait` edge launches it detached and leaves the same probe available to watchdog monitoring without gating Explorer startup. LiveKit and TURN readiness remains private and script-based through the blocking dependency graph, while only reviewed public media-plane sockets belong in `openPorts`.

Runtime isolation is defense in depth, not a hostile multi-tenant guarantee. Containers, bubblewrap, and Seatbelt reduce host exposure, but enabled agent code remains trusted operator-controlled code inside one workspace. Manifest volumes, runtime resources, lifecycle hooks, and network access are intentional grants and must be reviewed as part of the agent contract. Relative manifest volume paths must remain workspace-confined; an explicit absolute host path is permitted only when the manifest deliberately grants it. Durable service data belongs under `.ploinky/data/<agent-or-service>/...`, and generated runtime inputs belong under `.data/<agent>/...`.

Default Explorer containerized agents should use the shared `docker.io/assistos/ploinky-node:24-bookworm-tools` runtime image unless a local spec documents a specific exception. That image is the supported Node 24 glibc baseline for the default dependency graph and preinstalls the system tools needed by Ploinky dependency-cache preparation and the enabled Explorer agents. Using one image keeps cache invalidation, deploy pre-pulls, and cold-start behavior predictable across `AchillesIDE` and `proxies/soul-gateway`.

File and static-content handling must stay workspace-confined. Paths must be resolved relative to the workspace root, agent root, configured data directory, or explicit runtime volume. Explorer declares a custom `manifest.agent` command, so its `filesystem-http-server.mjs` process, not the shared Ploinky `AgentServer`, owns `/index.html` and frontend asset serving after the router proxies `/explorer/...` requests. That static serving must resolve from `PLOINKY_CODE_DIR` or `/code`, reject traversal segments and NUL bytes, and keep resolved paths inside the code root. Code must not assume host-specific absolute paths, follow symlink escapes, or place secrets in static roots, plugin assets, HTML documentation, logs, transcripts, screenshots, or test fixtures.

Logs and user-facing errors must not expose secrets, cookies, bearer tokens, invocation JWTs, API keys, raw prompts, hidden policy text, or internal payloads. Detailed diagnostics belong behind explicit debug modes and must still redact sensitive values before persistence. The Explorer smoke harness must sanitize complete browser-event records again at the file-write boundary, including generated JWTs and sensitive URL query or object fields that are not present in the test process environment. Playwright traces remain disabled because their raw network archive has no credential-redaction hook.

Agent-local contract:

- Manifest: `explorer/manifest.json`
- Role: Multi-agent AchillesIDE repository and Explorer static-agent surface.
- Authentication: Explorer and dependent agents inherit route policy from their manifests and Ploinky enable-time auth records.
- HTTP service surface: Explorer and WebMeet HTTP service prefixes and product route-access entries must be manifest-declared and routed through Ploinky core generically.
- Persistent state: Workspace files, confidential DPU objects, WebMeet data, and visitor records stay in their owning agent boundaries.
- Documentation: `docs/index.html`
- Validation: `npm test` in the affected agent plus Ploinky smoke tests for routing or auth changes.

The documentation website at `docs/index.html` must keep direct references to the docs or agent guides for Explorer, `dpuAgent`, `gitAgent`, `multimedia`, `onlyOffice`, `soplangAgent`, `tasksAgent`, `webAssist`, `webmeetAgent`, `webmeetLivekitAiAgent`, `webmeetInfra`, the split `webmeetInfra/liveKitServerAgent` and `webmeetInfra/turnServerAgent`, `basic/web-publishing`, and the local Ploinky docs. The Ploinky references must include `docs/specs/DS005-routing-and-web-surfaces.md` and `docs/specs/DS011-security-model.md` so future work can reach the routing and security invariants from the website.

## Decisions & Questions

### Question #1: Why duplicate Ploinky invariants inside every agent spec set?

Response:
Coding work often starts from an individual agent directory, where only local guidance may be read before changes are made. Keeping these Ploinky invariants in the local specification set prevents agents from accidentally treating router auth, guest mode, direct ports, or invocation headers as agent-specific implementation details that can be bypassed.

### Question #2: Why is route authentication not enough for domain authorization?

Response:
Ploinky establishes who the caller is and signs the invocation path, but domain ownership remains inside the agent. The agent knows which files, records, rooms, leads, secrets, repositories, media objects, or infrastructure controls are safe for that caller. Each agent must therefore enforce its own resource policy after reading verified auth context.

### Question #3: Why do managed deploy workflows require TURN TLS and DNS before touching the running workspace?

Response:
The workflows do not own certificate issuance or Cloudflare control-plane mutation. Validating the operator-provisioned certificate/key, mode/TLS-edge pairing, and public TURN DNS resolution before shutdown keeps a missing prerequisite from turning an otherwise healthy deployment into downtime. The address checks catch absent and mismatched A records, reject every AAAA result for the IPv4-only TURN endpoint, and fail closed on unexpected IPv6 lookup errors in every accepted mode, while the separate DNS-only requirement acknowledges that ordinary DNS resolution cannot verify Cloudflare's proxy toggle.

## Conclusion

`AssistOSExplorer` remains compatible with Ploinky only while it preserves router-mediated entry, secure-wire invocation, scoped guest behavior, explicit manifest-declared route policy and HTTP-service boundaries, workspace-confined storage, redacted logging, and local domain authorization. Any source change that affects these contracts must update this specification, the local docs, and the local guide files in the same change set.
