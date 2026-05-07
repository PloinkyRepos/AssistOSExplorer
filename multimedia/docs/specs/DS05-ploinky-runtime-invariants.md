---
id: DS05
title: Ploinky Runtime Invariants
status: implemented
owner: achilleside-team
summary: Captures the Ploinky routing, authentication, guest, secure-wire, sandbox, and documentation invariants that must remain in local context when changing this agent.
---

# DS05 - Ploinky Runtime Invariants

## Introduction

This specification makes the Ploinky runtime and security invariants local to `multimedia`. Future work from inside this agent directory must not rely on external memory of Ploinky core behavior; the local specs must carry the same high-level constraints that Ploinky defines in its routing and security model.

The authoritative upstream contracts are Ploinky `docs/specs/DS005-routing-and-web-surfaces.md` and `docs/specs/DS011-security-model.md`. This file restates only the invariants that affect this agent's implementation and documentation.

## Core Content

`multimedia` must treat the Ploinky router as the browser and MCP trust broker. Browser surfaces, first-party MCP calls, delegated MCP calls, uploads, blobs, and manifest-declared HTTP services are expected to enter through the router so route authentication, session handling, invocation minting, and audit behavior can apply. Direct agent ports are implementation details even when they are bound to localhost.

Executable MCP operations must be authorized by router-minted invocation JWTs. The agent runtime may receive `PLOINKY_WIRE_SECRET`, which is the HKDF-derived invocation subkey, but it must never receive or require `PLOINKY_MASTER_KEY`. Code must not invent alternate bearer-token, client-secret, or caller-header authorization paths around the router's secure-wire model.

The compact `x-ploinky-auth-info` header is not a secure grant by itself. Any HTTP service that receives that header must trust it only when it arrived through a declared Ploinky HTTP service route and, for guest services, only after validating the router-issued invocation token and the expected guest role or scope. Caller-supplied copies of identity headers must be rejected as authoritative input.

Guest access must remain scoped to the route shape declared by the owning manifest. Manifest-level `guest: true` exposes the agent as a normal guest agent and should still enforce limitations from `usr.roles`. An `httpServices` entry with `auth: "guest"` exposes only the declared HTTP prefix; `forceGuest: true` must ignore any existing workspace login and mint a service-scoped guest session. Product-specific public paths must be declared in the agent manifest rather than hard-coded in Ploinky core.

Agent code must enforce its own domain authorization. Ploinky route authentication identifies the caller and signs the invocation, but it does not grant every domain operation. Sensitive actions must check the verified user, roles, scopes, target resource, workspace path, and agent-local policy before reading or mutating state.

Runtime isolation is defense in depth, not a hostile multi-tenant guarantee. Containers, bubblewrap, and Seatbelt reduce host exposure, but enabled agent code remains trusted operator-controlled code inside one workspace. Manifest volumes, runtime resources, lifecycle hooks, and network access are intentional grants and must be reviewed as part of the agent contract.

File and static-content handling must stay workspace-confined. Paths must be resolved relative to the workspace root, agent root, configured data directory, or explicit runtime volume. Code must not assume host-specific absolute paths, follow symlink escapes, or place secrets in static roots, plugin assets, HTML documentation, logs, transcripts, screenshots, or test fixtures.

Logs and user-facing errors must not expose secrets, cookies, bearer tokens, invocation JWTs, API keys, raw prompts, hidden policy text, or internal payloads. Detailed diagnostics belong behind explicit debug modes and must still redact sensitive values before persistence.

Agent-local contract:

- Manifest: `multimedia/manifest.json`
- Role: Media plugin and FFmpeg-backed processing boundary for Explorer document media.
- Authentication: Media actions must remain behind Explorer/plugin and MCP context and must not expose workspace files through anonymous routes. Manifest guest: none.
- HTTP service surface: No public HTTP service is declared; plugin assets are static resources and must not include secrets. Manifest httpServices: none.
- Persistent state: Media reads and writes must stay within explicit workspace, document, or runtime paths. Manifest volumes: none.
- Documentation: `docs/index.html`
- Validation: Run syntax checks and media workflow smoke checks for changed plugin or script paths.

## Decisions & Questions

### Question #1: Why duplicate Ploinky invariants inside every agent spec set?

Response:
Coding work often starts from an individual agent directory, where only local guidance may be read before changes are made. Keeping these Ploinky invariants in the local specification set prevents agents from accidentally treating router auth, guest mode, direct ports, or invocation headers as agent-specific implementation details that can be bypassed.

### Question #2: Why is route authentication not enough for domain authorization?

Response:
Ploinky establishes who the caller is and signs the invocation path, but domain ownership remains inside the agent. The agent knows which files, records, rooms, leads, secrets, repositories, media objects, or infrastructure controls are safe for that caller. Each agent must therefore enforce its own resource policy after reading verified auth context.

## Conclusion

`multimedia` remains compatible with Ploinky only while it preserves router-mediated entry, secure-wire invocation, scoped guest behavior, explicit manifest-declared HTTP services, workspace-confined storage, redacted logging, and local domain authorization. Any source change that affects these contracts must update this specification, the local docs, and the local guide files in the same change set.
