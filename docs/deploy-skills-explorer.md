# Deploy Explorer with Ploinky Box

Deployment is operator-controlled. Codex sessions are authorized operators when
the user's task selects the target deployment operation. They may invoke the
tracked GitHub Actions deployment workflows with `gh` or use direct SSH,
Ploinky CLI, container, registry, Cloudflare, DNS, and other remote operations
needed to complete that selected task.

The tracked `deploy-explorer-qa.yml` and `deploy-skills-explorer.yml` workflows
are supported execution channels. Before dispatch, inspect the workflow at the
requested revision and verify its exact inputs, target guards, credentials,
branch selection, and fallback behavior against the user's requirements. A
workflow name or historical successful run is not evidence that its current
implementation satisfies those requirements. If an explicit request forbids
`--branch-fallback`, do not dispatch a workflow that injects that option; use an
authorized direct channel or update and verify the workflow first.

The Explorer QA deploy workflow has no mutable branch inputs. It resolves
Ploinky and every managed application repository from each remote's configured
default branch, while keeping explicit per-repository selections for the graph.
It then reads the canonical achillesAgentLib URL and immutable commit from the
selected Ploinky dependency lock, requires that commit to equal the AgentLib
remote default-branch head, and uses fail-closed branch selection. Once all 18
agents are running, the workflow validates Ploinky's deployment attestation for
the core and every admitted agent. The paired destroy workflow requires only
its explicit destructive confirmation and preserves the deployed runtime as
the authority for teardown.

Direct operator execution has the same authority and safety boundary. Before a
destructive or externally visible mutation, positively identify the exact host,
workspace, environment, revisions, images, and rollback state. Authorization
for QA or local deployment never authorizes production or unrelated workloads.
Never expose secret values in commands, logs, reports, or artifacts.

## Required sequence

1. Back up application data, then complete the destructive credential/state
   prerequisites documented by Ploinky operations.
2. Build or pull the pinned multi-architecture box and dependency images.
3. Configure either explicit local-only mode or a complete dedicated-tunnel
   Cloudflare configuration. Never create a quick tunnel. The tracked Explorer
   QA workflow may create or reuse exactly one persistent `explorer-qa` tunnel
   only when the selected operation explicitly authorizes that test resource;
   it must preserve the pinned shared `proxies` tunnel and unrelated DNS,
   validate the new connector credential against the selected account/tunnel,
   and keep connector and management credentials in separate encrypted handles.
4. Configure the literal public media IPv4 and external relay service.
5. Recreate the Box explicitly under the semantic Box contract.
6. Inspect the real outer container and prove its normalized bindings are
   exactly loopback Router TCP and wildcard LiveKit UDP `7882`.
7. Start the full Explorer graph and validate the topology-aware in-box
   listener gate. Loopback is `required-loopback`; a managed gateway is
   `required-assigned-managed-gateway` only when current Podman and kernel
   evidence prove assignment to the exact reported `network_interface`; an
   unassigned gateway is `inactive-unassigned-managed-gateway`, has no
   listener, and remains inactive and fail-closed.
8. While the graph remains alive, run the fixed Chromium Router/auth baseline
   below with no retry or skip.
9. Revalidate outer publication and listener ownership.
10. Run the real-browser OnlyOffice, Umami, GPTResearcher, and WebMeet gates.
11. Clean up and destroy the graph only after all graph-dependent gates finish.

The Ploinky release harness runs this exact baseline after the full graph and
listener gate succeed and before cleanup or graph destruction:

```bash
cd tests/smoke
SMOKE_BASE_URL=http://127.0.0.1:18080 npm test -- --project=chromium specs/00-router-auth.spec.mjs
```

It proves the dashboard, Explorer shell, and routed WebChat shell through
Router. This oracle is distinct from the WebMeet external-network and
ScreenShare gates below; none substitutes for another. A missing or failing
baseline is a release failure and must not be retried, skipped, or weakened.

The WebMeet screen gate is:

```bash
cd tests/smoke
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_WEBMEET_MEDIA=1 \
SMOKE_WEBMEET_SCREEN=1 \
SMOKE_TEST_TIMEOUT_MS=240000 \
npm test -- --headed --project=chromium specs/30-webmeet-room-chat.spec.mjs
```

This command requires two distinct authenticated accounts. On Linux without a
display, the runner creates a deterministic Xvfb display. Missing accounts,
media, or real infrastructure are hard failures while the screen flag is set.
The local gate removes TURN and requires both browsers to use active non-relay
UDP `7882` pairs during each ScreenShare direction. Exact configured-public-IP
selection is intentionally reserved for the distinct-network native x64/arm64
matrix, which also rejects `7881` and private/discovered alternatives.

Cloudflare, external relay, cross-network, native x64, and native arm64 gates
must use dedicated test resources. A missing prerequisite is reported as
BLOCKED with the reproducible command; it is never treated as a pass.

An inactive managed gateway does not authorize a wider bind, forwarder, direct
target, or alternate authorization path. Ploinky DS004 Question #8 remains the
owner of any architecture change needed to activate that lane.
