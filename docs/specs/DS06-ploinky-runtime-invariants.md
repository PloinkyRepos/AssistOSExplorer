---
id: DS06
title: Ploinky Runtime Invariants
status: partially implemented (rootless private-router reachability blocked)
owner: achilleside-team
summary: Captures Explorer's runtime-v5 routing, topology, authorization, publication, and isolation invariants.
---

# DS06 - Ploinky Runtime Invariants

## Core Content

### Runtime boundary

Explorer and every enabled dependency run behind Ploinky Router. The outer box
has one loopback TCP publication for Router and one wildcard UDP publication
for the LiveKit mux. Manifests, profiles, dependency graphs, readiness state,
and agent state cannot add another physical-host mapping.

Runtime v5 names this coordinated architecture. Its current outer container
image must independently carry Box image contract label `6`; release evidence
that still requires label `5` is stale and must fail closed.

Router owns public/control listener `8080` and box-private listener `8081`.
Private operations require both effective authenticated policy and an exact
current-instance/current-enable-generation caller ACL. Method, path, audience,
body digest, nonce, expiry, and replay state are bound by the assertion. An
assertion is never a user or administrator credential.

The private Router listener gate has three exact states:

- `required-loopback`: `127.0.0.1:8081` is required whenever RoutingServer is
  ready.
- `required-assigned-managed-gateway`: a current managed bridge IPAM gateway is
  eligible only when current Podman inspection and kernel address inventory
  prove that it is assigned to the exact reported `network_interface`; every
  eligible gateway requires exactly one private listener.
- `inactive-unassigned-managed-gateway`: a gateway absent from that exact
  interface is inactive and must have no listener. The inactive state remains
  fail-closed and is not evidence of managed-bridge activation or reachability.

Missing or stale address evidence, assignment on another interface, a missing
eligible listener, an extra listener, a wildcard, or an unrelated bind fails
closed. On the currently observed rootless Podman topology,
`host.containers.internal:host-gateway` terminates on the box outer-facing
interface rather than loopback or an address assigned to a managed inner
bridge. Binding private `8081` there would violate the approved interface
boundary, while the managed bridge gateway is unassigned in the outer
namespace. Managed-bridge private service activation therefore remains
inactive and fail-closed. Explorer must not add a wider bind, forwarding
sidecar, direct-target fallback, or alternate authorization path; Ploinky DS004
Question #8 owns the unresolved architecture decision.

HTTP, SSE, and WebSocket requests use the same immutable route-and-policy
generation. Host/interface class is resolved before pathname dispatch. Unknown,
stale, malformed, suffix-confusable, unauthorized, or generation-drifted
requests fail before any upstream connection is created.

### Topology

Ploinky atomically mounts schema-v2 topology before consumers start and injects
`PLOINKY_EDGE_TOPOLOGY_FILE`, `PLOINKY_ROUTER_URL`, and
`PLOINKY_INTERNAL_ROUTER_URL`. The snapshot is non-secret, immutable by
generation, and contains active browser locators but no private target ports,
credentials, or product-specific core knowledge.

Long-lived consumers resolve the current snapshot per join, editor-session
creation, dashboard open, or other locator-producing operation. Browsers use
only the authenticated one-locator no-store projection. Unknown schema,
inactive selector, stale generation, missing locator, or publication error
fails closed; consumers do not synthesize hostnames or fall back to startup
environment.

### Agent contracts

- Manifests use slim `httpServices`; an optional service `port` selects a
  distinct private TCP target.
- OnlyOffice declares authenticated control and narrowly public editor targets.
- LiveKit declares public signaling and private Twirp services on loopback
  `7880`; media alone owns box UDP `7882` under an exact generation capability.
- Umami declares authenticated dashboard target `3000` and narrow guest
  telemetry target `3001`.
- Extra application servers such as GPTResearcher declare their explicit TCP
  target and verified base path.
- Default bridge launch uses the single managed host-gateway mapping. Host mode
  is a capability for a precise generation, never authorization by localhost.

### Identity and secrets

Executable MCP operations require Router-minted request JWTs. Agents receive
only their own Ploinky identity material and scoped generated/shared-generated
secrets; they never receive a derivation master key. Caller-supplied identity,
delegation, forwarding, cookie, or authorization headers cannot bypass Router
policy or agent domain authorization.

Logs, traces, screenshots, and diagnostics redact cookies, bearer material,
API keys, callback tokens, assertions, and private payloads. Trace resources
also redact dynamic participant JWTs, TURN usernames/credentials, CSRF values,
and router assertions even when those values were not present in the runner
environment. Sanitization parses JSON and Playwright NDJSON structurally,
preserves record parseability, covers named query/form and cookie entries, and
post-scans every textual archive member for credential-shaped residue before an
artifact is attached. Detailed health is supervisor-only on an unmounted Unix
socket.

### Hard cut

Runtime contract v5 accepts no previous runtime state. Operators must revoke
obsolete connector credentials, delete obsolete plaintext state, and recreate
the box explicitly before activation. Runtime v5 has no import, cleanup,
compatibility, dual-write, automatic recreate, or failure-mode fallback path.

Explorer deployment automation must use box-owned publication and topology.
Agent-owned edge publication is not part of the dependency graph, plugin set,
workflow, or configuration surface.

### Verification

Changes affecting this contract require unit and integration tests plus the
real-engine exact-publication smoke. After the Ploinky full graph and listener
gate succeed, the release harness must keep that graph alive and run this fixed
Chromium Router/auth baseline before cleanup or graph destruction, without a
retry or skip:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
SMOKE_BASE_URL=http://127.0.0.1:18080 npm test -- --project=chromium specs/00-router-auth.spec.mjs
```

The baseline proves the dashboard, Explorer shell, and routed WebChat shell
through Router. It is distinct from the WebMeet two-account bidirectional
ScreenShare gate and the WebMeet external-network direct UDP, relay UDP, and
relay TLS lanes on native Linux x64 and arm64; none substitutes for another.

## Decisions & Questions

### Question #1: Why is this specification only partially implemented?

Response:
The approved private Router contract requires managed bridge callers to reach
an interface that is neither the physical-host edge nor the box outer-facing
interface. The observed rootless host-gateway mapping does not provide such an
address. Marking the slice partial preserves the fail-closed implementation
evidence and prevents documentation from silently treating a wider listener or
forwarder as an accepted substitute.

### Question #2: Why is the fixed Chromium baseline separate from the WebMeet gates?

Response:
The fixed baseline is the release oracle for Router authentication and the
three primary routed browser shells while the full graph is alive. WebMeet
screen sharing and external-network transport prove different media and
network properties, so passing either WebMeet lane cannot replace a failure of
the Router/auth oracle.
