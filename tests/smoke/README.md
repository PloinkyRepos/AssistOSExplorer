# AssistOS Explorer Headless Smoke Suite

This package contains the maintainable Playwright smoke suite for Explorer, WebChat, WebMeet, DPU/OnlyOffice, and GitHub plugin paths.

## Quick Start

From this directory:

```bash
npm ci
npm run install:browsers
SMOKE_BASE_URL=http://127.0.0.1:8080 npm test
```

The default local credentials are `admin` / `admin` and `user` / `user`. Override them with:

```bash
SMOKE_USERNAME=admin SMOKE_PASSWORD=admin \
SMOKE_SECONDARY_USERNAME=user SMOKE_SECONDARY_PASSWORD=user \
SMOKE_BASE_URL=https://skills.axiologic.dev \
npm test
```

Run the dedicated public QA acceptance gate in headless Chromium with:

```bash
SMOKE_USERNAME=admin SMOKE_PASSWORD='<qa-admin-password>' npm run test:qa
```

`test:qa` is pinned to `https://explorer-qa.axiologic.dev`. It creates two
run-scoped Explorer users through the Administration UI, runs exactly two
browser tests, and removes the generated users afterward. The first test
creates a legacy `.doc` under `/Confidential/My Space`, proves the active
editor is writable OnlyOffice with autosave enabled, makes a browser edit
without clicking Save, and reopens the document to prove persistence. The
second test has the two generated users create and join one WebMeet room and
proves that a message from each user is visible to the other. It also opens the
standalone WebMeet loader as an authenticated user, creates a public room, and
proves an unauthenticated guest can join through its direct invitation URL.

If the machine still has a negative DNS cache from before the QA record was
created, set `SMOKE_QA_EDGE_IP` to one of the hostname's current public
Cloudflare IPv4 addresses. The override is accepted only by the QA profile.

Artifacts are written outside tracked source by default:

```text
../../.ploinky/test-artifacts/headless-smoke/<run-id>/
```

Playwright traces, screenshots, videos, and JSON reports stay under `tests/smoke/test-results/` and `tests/smoke/playwright-report/`.

## Explorer UI A/B Benchmark

`benchmark:ui` measures the same read-only Explorer interaction sequence against
two deployments. Each iteration uses a fresh Chromium context with the browser
cache disabled. The sequence covers Router/login, Explorer interactive
readiness, a root refresh, normal workspace directory navigation, DPU-backed
Confidential navigation, a normal workspace file open, and Git modal readiness.

Run the baseline only after its full agent graph is admitted and stable:

```bash
UI_BENCHMARK_LABEL=master \
UI_BENCHMARK_BASE_URL=http://127.0.0.1:8080 \
UI_BENCHMARK_PLOINKY_SHA=<deployed-ploinky-sha> \
UI_BENCHMARK_EXPLORER_SHA=<deployed-explorer-sha> \
npm run benchmark:ui
```

Cleanly replace the deployment, wait for the comparison graph to reach the same
readiness state, and run the identical command with a different label and the
deployed SHAs:

```bash
UI_BENCHMARK_LABEL=ploinky-proxy \
UI_BENCHMARK_BASE_URL=http://127.0.0.1:8080 \
UI_BENCHMARK_PLOINKY_SHA=<deployed-ploinky-sha> \
UI_BENCHMARK_EXPLORER_SHA=<deployed-explorer-sha> \
npm run benchmark:ui
```

The runner defaults to three fresh iterations and writes a mode-`0600`
`result.json` below:

```text
../../.ploinky/test-artifacts/ui-benchmark/<run-id>/
```

Compare the reports with the first result as the baseline:

```bash
npm run benchmark:ui:compare -- \
  <master-result.json> \
  <ploinky-proxy-result.json> \
  --output <comparison.json>
```

Negative comparison deltas mean the candidate is faster. The artifact contains
per-operation visible and network-settled latency, request timing grouped by
Router/Explorer/DPU/Git route, transfer and cache counts, duplicate and aborted
requests, browser long tasks, rendering/JavaScript CPU counters, and initial
page metrics. It deliberately excludes request and response bodies, headers,
cookies, credentials, URL queries, console text, screenshots, and traces.

Each step records whether its fixed 1,500 ms network tail completed the quiet
window or reached the cutoff. Cutoff samples include only a bounded active
request count and are excluded from settled-latency aggregates; their final
request summaries are rebuilt from the same immutable waterfall snapshot
written for the iteration. Long-task values also include observer support and
availability state, so unavailable instrumentation is reported as missing
rather than as zero work.

For a valid A/B result, use the same host, clean workspace fixture, browser
version, viewport, iteration count, paths, and fully admitted deployment state.
The comparison command validates the complete scenario fingerprint and the
recorded target, browser, headless/cache, viewport, platform, architecture, OS,
and Node controls before producing output. Do not run the deployments
concurrently. This benchmark is a performance probe; it does not replace the
functional smoke or release suites.

## Explorer Deployment Resource A/B Benchmark

`benchmark:resources` measures steady-state resource consumption for the full
Explorer graph. The first report is required to come from the direct-host
`master` deployment; the second is required to come from the nested
`ploinky-proxy` Box deployment. Run both sequentially on the same dedicated
Linux host with the same clean workspace data, exact 16-target graph, container
runtime version, kernel, Node version, CPU, and memory.

Keep the benchmark harness itself at one fixed commit outside the workspace
being replaced. The harness source is not part of the deployment under test.
After the direct-host master graph is admitted and has no active browser or
external workload, record the reference:

```bash
RESOURCE_BENCHMARK_LABEL=master \
RESOURCE_BENCHMARK_VARIANT=master \
RESOURCE_BENCHMARK_DEPLOYMENT_ID=<non-secret-master-deployment-id> \
RESOURCE_BENCHMARK_PLOINKY_SHA=<exact-deployed-master-sha> \
RESOURCE_BENCHMARK_EXPLORER_SHA=<exact-deployed-master-explorer-sha> \
npm run benchmark:resources
```

Cleanly replace the deployment with `ploinky-proxy`, admit the same exact graph,
leave it idle, and record the candidate:

```bash
RESOURCE_BENCHMARK_LABEL=ploinky-proxy \
RESOURCE_BENCHMARK_VARIANT=ploinky-proxy \
RESOURCE_BENCHMARK_DEPLOYMENT_ID=<non-secret-proxy-deployment-id> \
RESOURCE_BENCHMARK_PLOINKY_SHA=<exact-deployed-proxy-sha> \
RESOURCE_BENCHMARK_EXPLORER_SHA=<exact-deployed-proxy-explorer-sha> \
npm run benchmark:resources
```

The v1 protocol uses a five-minute warmup followed by 30 minutes of sampling
every ten seconds. It reads whole-host CPU counters, memory, swap, load,
processes, and zombies directly from `/proc`. It queries Podman only before
warmup, after warmup, and after sampling. A report fails if the direct master
contains an outer Box, the proxy does not contain exactly one outer Box, the
running target count is not exactly 16, or any target/Box identity changes
during the run.

Results are mode-`0600` files below:

```text
../../.ploinky/test-artifacts/resource-benchmark/<run-id>/result.json
```

Compare them with the master report first:

```bash
npm run benchmark:resources:compare -- \
  <master-result.json> \
  <ploinky-proxy-result.json> \
  --output <comparison.json>
```

The comparison rejects different host or scenario fingerprints and reports
master-relative p95 CPU, memory, swap, load, and process counts; maximum zombie
count; and memory, process, and zombie growth per minute. Positive deltas mean
the proxy candidate consumed more. The initial comparison is evidence, not an
arbitrary pass/fail budget: establish explicit release thresholds only after a
valid master reference and a corrected proxy candidate have both been captured.

No historical master resource artifact exists in this repository. Do not
substitute the currently overloaded proxy measurements for the reference, and
do not claim comparability if the exact historical master deployment cannot be
reproduced on the controlled host.

## Fixed Router/Auth Release Baseline

The Ploinky release harness runs this exact Chromium baseline after the full
graph and topology-aware listener gate succeed. The harness keeps the graph
alive while it runs and executes it before cleanup or graph destruction, with
no retry, skip, or weakened assertion:

```bash
cd ${WORKSPACE_ROOT}/AssistOSExplorer/tests/smoke
SMOKE_BASE_URL=http://127.0.0.1:18080 npm test -- --project=chromium specs/00-router-auth.spec.mjs
```

It proves the dashboard, Explorer shell, and routed WebChat shell through
Router. It is not the separate WebMeet external-network or two-account
ScreenShare gate, and none of those gates substitutes for another.

The listener gate always requires `required-loopback`, requires exactly one
listener for each eligible `required-assigned-managed-gateway`, and requires no
listener for an `inactive-unassigned-managed-gateway`. The inactive state
remains fail-closed and does not prove managed-bridge activation or
reachability. Missing or stale assignment evidence, cross-interface assignment,
a missing or extra listener, a wildcard, or an unrelated bind fails closed.

## Coverage

Default smoke checks:

- Router auth, dashboard, Explorer shell, and WebChat shell.
- WebChat file and folder uploads through the browser.
- WebChat upload containment evidence from the upload response: `uploads/<sessionId>/...`.
- Session-scoped WebChat `@` file suggestions by comparing two browser contexts.
- WebChat provider-looking `@open-interpreter` text is not offered as a dispatch suggestion.
- WebMeet room creation, two-account join, chat delivery, and cleanup.
- WebMeet provider-looking `@open-interpreter` text stays ordinary meeting chat.

Opt-in checks:

- `SMOKE_OPEN_INTERPRETER=1` runs Copilot semantic routing and AKU memory checks that require configured external provider runtime.
- `SMOKE_WEBMEET_MEDIA=1` enables fake camera/microphone and asserts WebRTC stats increase.
- `npm run test:webmeet-headless` is the automated WebMeet acceptance profile. It runs in headless Chromium with deterministic synthetic camera and microphone sources, requires two distinct configured accounts, proves room create/join and bidirectional chat, exercises settings/privacy and ordinary tagged-research chat, and requires separate growing outbound audio, outbound video, inbound audio, and inbound video RTP stats in both browsers. It forbids headed execution and screen sharing.
- `npm run test:webmeet-screen` remains a separate explicit, headed, opt-in gate for physical-display ScreenShare capture. It is not part of `test:full` or automated headless acceptance. Both distinct accounts must authenticate and exchange real LiveKit screen tracks in both directions. The probe removes TURN servers, and each direction requires active non-relay selected pairs using a globally routable IPv4 and UDP 7882 in both browsers alongside exact ScreenShare publication identities and source-specific RTP packet/frame growth. When Chromium redacts a peer-reflexive remote address or port, every observable field must still be correct and the missing field is replaced only by a proof bound to the exact LiveKit container generation and its real UDP 7882 listener. An observable wrong address, port, protocol, relay candidate, changed generation, or invalid server proof fails. The gate never stubs `getDisplayMedia` or skips a missing secondary account. This local gate does not claim the address equals the configured public IPv4; that stricter assertion belongs to the native external-network matrix below.
- `SMOKE_WEBMEET_REFRESH=1` adds the real join-material lifecycle gate. Both browsers must receive a scheduled material rotation before the original TURN expiry, remain joined with growing RTP after that original expiry, then survive a real Playwright offline/online transition with another broker call, disconnect/recreate/rejoin, and renewed RTP. This gate requires `SMOKE_WEBMEET_MEDIA=1` and a test box started with a short supported credential lifetime (recommended `PLOINKY_TURN_CREDENTIAL_TTL_SECONDS=60`); it fails rather than mocking time or join responses when the original expiry exceeds `SMOKE_WEBMEET_REFRESH_MAX_WAIT_MS` (default 180000).
  Only non-secret SHA-256 fingerprints are attached, and both the participant
  token and credential-bearing RTC configuration must rotate independently.

On macOS, keep the automated headless profile running when physical monitors
are off by holding system-sleep assertions for the lifetime of the command:

```sh
caffeinate -dimsu npm run test:webmeet-headless
```

Run the separate headed screen-share gate against a fresh host-local deployment with:

```sh
SMOKE_DEPLOYMENT_MODE=local SMOKE_BASE_URL=http://127.0.0.1:8080 SMOKE_WEBMEET_MEDIA=1 SMOKE_WEBMEET_SCREEN=1 SMOKE_TEST_TIMEOUT_MS=240000 npm test -- --headed --project=chromium specs/30-webmeet-room-chat.spec.mjs
```

In local mode the wrapper requires exactly one freshly started, managed
`liveKitServerAgent` container using host networking and no container port
publications. It also rejects any concurrently running outer Ploinky Box. The
wrapper runs `ss` inside that exact network namespace to prove the UDP 7882
listener before and after the browser run. The real browser assertions then
prove bidirectional non-relay UDP/7882 traffic.

Run the same gate against a fresh Ploinky Box deployment with:

```sh
SMOKE_DEPLOYMENT_MODE=box SMOKE_BASE_URL=http://127.0.0.1:8080 SMOKE_WEBMEET_MEDIA=1 SMOKE_WEBMEET_SCREEN=1 SMOKE_TEST_TIMEOUT_MS=240000 npm test -- --headed --project=chromium specs/30-webmeet-room-chat.spec.mjs
```

In Box mode, exactly one outer container must publish
`127.0.0.1:<SMOKE_BASE_URL port>:8080/tcp` and
`0.0.0.0:7882:7882/udp`, carry the exact semantic Box ownership labels, and use a freshly built
image. No additional outer-container port publication is accepted. By default
the running generation must be at most 30 minutes
old and the image at most four hours old. The wrapper binds the test to that
container ID, start time, image ID/reference, and normalized two-publication
boundary, re-inspects it after Playwright exits, and fails if any value changed.
It also inspects nested Podman through that exact outer container, binds the
nested LiveKit container ID and start time, requires host networking with zero
inner bindings, and proves UDP 7882 with `ss` in the nested LiveKit namespace.
`SMOKE_PLOINKY_BOX_CONTAINER`, `SMOKE_EXPECT_BOX_IMAGE_ID`, and
`SMOKE_EXPECT_BOX_IMAGE_REF` can pin expected values more narrowly. The command
does not accept a pre-authored evidence file or a bypass for this live check.

The native external-network release matrix is separate from the local screen-share gate. Run it once on native Linux amd64 (`SMOKE_EXPECT_ARCH=x64`) and once on native Linux arm64 (`SMOKE_EXPECT_ARCH=arm64`) against a freshly built Box. It requires two dedicated Chromium CDP endpoints on distinct external networks, their independently verified egress IPv4 addresses, a CORS-enabled test echo endpoint, the configured LiveKit public IPv4, two distinct accounts, external TURN test credentials, and lane-specific test topology. The command runs `direct-udp`, `turn-udp`, and `turn-tls` in sequence and hard-fails on missing prerequisites:

```bash
SMOKE_EXPECT_ARCH=x64 \
SMOKE_BASE_URL=https://explorer.test.example \
SMOKE_WEBMEET_PUBLIC_IPV4=203.0.113.10 \
SMOKE_PLOINKY_BOX_CONTAINER=ploinky-box-explorer-0123456789ab \
SMOKE_EXPECT_BOX_IMAGE_REF=docker.io/assistos/ploinky-box:runtime \
SMOKE_EXPECT_BOX_IMAGE_ID=sha256:<exact-64-hex-image-id> \
SMOKE_EXTERNAL_TCP_PROBE_RUN_ID=<fresh-nonce> \
SMOKE_EXTERNAL_SCANNER_A_SSH_TARGET=scanner-a \
SMOKE_EXTERNAL_SCANNER_B_SSH_TARGET=scanner-b \
SMOKE_EXTERNAL_SCANNER_A_HOST_FINGERPRINT_SHA256='SHA256:<pinned-openssh-fingerprint-a>' \
SMOKE_EXTERNAL_SCANNER_B_HOST_FINGERPRINT_SHA256='SHA256:<pinned-openssh-fingerprint-b>' \
SMOKE_EXTERNAL_TURN_UDP_URL='turn:turn-udp.test.example:3478?transport=udp' \
SMOKE_EXTERNAL_TURN_TLS_URL='turns:turn-tls.test.example:5349?transport=tcp' \
SMOKE_BROWSER_A_CDP_URL=wss://browser-a.test/devtools/browser/id-a \
SMOKE_BROWSER_B_CDP_URL=wss://browser-b.test/devtools/browser/id-b \
SMOKE_BROWSER_A_NETWORK_ID=external-net-a \
SMOKE_BROWSER_B_NETWORK_ID=external-net-b \
SMOKE_BROWSER_A_EXPECTED_EGRESS_IPV4=198.51.100.21 \
SMOKE_BROWSER_B_EXPECTED_EGRESS_IPV4=198.51.100.22 \
SMOKE_NETWORK_ECHO_URL=https://echo.test.example/ip \
SMOKE_USERNAME='<account-a>' SMOKE_PASSWORD='<account-a-password>' \
SMOKE_SECONDARY_USERNAME='<account-b>' SMOKE_SECONDARY_PASSWORD='<account-b-password>' \
npm run test:webmeet-network-matrix
```

Replace the documentation-only IPv4 values above with globally routable
literals; the runner rejects RFC 1918, loopback, link-local, benchmark, and
documentation ranges. The two TURN URLs are non-secret endpoint selectors.
Short-lived usernames and credentials must arrive in each browser's real join
material and are never accepted in these environment variables or artifacts.

For the direct lane, the browser probe removes relay servers and every active
selected pair must use the configured public IPv4 and UDP 7882; UDP 7881 and
private/discovered alternatives fail. The TURN/UDP lane retains only explicit
`turn:` UDP URLs matching the configured external host and port and sets the
real peer connection to relay-only. The TURN/TLS lane retains only the exact
`turns:` TLS-over-TCP endpoint and also sets relay-only. Each browser must show
separate growing outbound audio, outbound video, inbound audio, and inbound
video RTP rows. This forces real transport selection without mocking LiveKit
signaling, peer connections, or media. The remote egress check proves the
browsers are on distinct external networks instead of trusting labels alone.
CDP endpoints and echo/TURN resources must be dedicated test resources. CDP
endpoints must use credential-free, query-free HTTPS or WSS URLs; the echo URL
must likewise be credential-free, query-free HTTPS. The runner redacts complete
CDP URL values from diagnostics as a second defense for opaque endpoint paths.

Before each lane starts, the wrapper connects non-interactively to one dedicated
scanner on each named external browser network and sends the repository-owned
scanner program directly to `python3` over stdin. The two SSH targets must be
distinct aliases (or `user@host` values) with pinned host keys already present
in the runner's `known_hosts`; the expected OpenSSH `SHA256:...` host-key
fingerprints are also required explicitly. `BatchMode=yes`,
`StrictHostKeyChecking=yes`, and a non-multiplexed SSH connection are mandatory,
and the negotiated key must equal the configured fingerprint. No scanner
credential is accepted in an environment variable. Each executed scanner verifies its HTTPS echo egress,
scans the configured public IPv4 across the complete TCP range 1..65535, and
sends an unauthenticated STUN Binding request without MESSAGE-INTEGRITY to UDP
7882. The lane requires `openPorts:[]` and requires that invalid ICE request to
time out or receive a STUN error—never a success response.

The wrapper records schema-version-2 evidence bound to the fresh probe nonce,
exact outer container ID/start/image, target IPv4, scanner source SHA-256,
SSH target SHA-256, negotiated host-key fingerprint, exact returned-byte
SHA-256, unique scan ID, and scan
timestamps. It passes only those non-secret fingerprints to the browser spec,
which independently revalidates them. Both scans must start after the current
box generation and finish no more than 15 minutes before validation. A stale or
partial scan, source/egress/fingerprint mismatch, invalid-ICE success, or any
open TCP port fails before either browser opens.

The matrix wrapper also requires a native rootless Podman server using Netavark. It
captures Podman client/server versions, native server OS/architecture,
Netavark version, and Aardvark DNS version. It also inspects the exact named
running outer container and exact expected image ID/reference, requires the exact
semantic Box labels and an unlabeled image, and normalizes `HostConfig.PortBindings` to exactly loopback Router
TCP plus wildcard UDP 7882. The image creation and container start times must
also satisfy the same bounded fresh-build/fresh-generation contract as the
local screen gate (`SMOKE_BOX_MAX_IMAGE_AGE_MS` and
`SMOKE_BOX_MAX_GENERATION_AGE_MS` may only tighten those hard maximum bounds).
Those records and the bound two-network TCP-negative
scan are attached to each lane's `container-engine-evidence.json`; missing or
mismatched evidence fails before either browser is opened. The wrapper
re-inspects the box after every lane, including a failed browser lane, and
aggregates a lane failure with any post-lane evidence failure. It fails if the
exact container generation changes while that lane runs. The TURN/TLS lane automatically
enables the real credential-expiry/network-transition gate.

On headed Linux without `DISPLAY`, the npm runner starts a deterministic 1920×1080 Xvfb display. It fails with an actionable error if Xvfb is unavailable; it does not downgrade to headless capture.
- `SMOKE_UMAMI=1` enables the real Umami Router gate. It authenticates first at
  Ploinky and then at Umami, proves dashboard HTML, assets, heartbeat API, and
  in-app navigation stay under
  `/base-agent-additional-server/umamiAgent/3000/`.
- `SMOKE_GPT_RESEARCHER=1` enables the real GPTResearcher Router gate for HTML,
  assets, reports API, same-origin redirect rewriting, and a browser WebSocket
  ping/pong under `/base-agent-additional-server/GPTResearcher/8000/`. Root-relative and private-origin
  requests fail the gate.
- `SMOKE_ONLYOFFICE=1` enables the real spec 50 editor gate. It creates an
  encrypted DPU document, types through the pinned OnlyOffice UI, clicks the
  actual `#btn-save`, proves the callback replaced the encrypted blob, then
  prepares authenticated CSRF-bound restart proof before typing a second
  distinct edit without clicking save. It proves DPU state is still unchanged,
  invokes the targeted restart without another authentication request, proves
  drain produced another callback acknowledgement, and reopens both markers.
- `SMOKE_GITHUB=1` enables GitHub plugin authentication checks.

Run the Umami publication gate against a fresh Box Explorer stack:

```bash
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_UMAMI=1 \
SMOKE_UMAMI_USERNAME=admin \
SMOKE_UMAMI_PASSWORD='<dedicated-test-password>' \
npm test -- --project=chromium specs/33-umami-routing.spec.mjs
```

Run the GPTResearcher publication gate:

```bash
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_GPT_RESEARCHER=1 \
npm test -- --project=chromium specs/34-gpt-researcher-routing.spec.mjs
```

Run the OnlyOffice DPU/save/drain/reopen gate with paths from the same fresh
workspace used by the box:

```bash
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_ONLYOFFICE=1 \
SMOKE_WORKSPACE_ROOT='<fresh-workspace>' \
SMOKE_TEST_TIMEOUT_MS=240000 \
npm test -- --project=chromium specs/50-onlyoffice-dpu.spec.mjs
```

These opt-in gates skip only while their flag is off. Once a flag is `1`,
missing credentials, topology, services, browser behavior, or sanitation
evidence is a hard failure.

## GitHub DPU Token Ownership

The GitHub smoke lane verifies the DPU-backed token ownership path used by
`gitAgent`. It stores a synthetic manual GitHub token through the router MCP
surface, confirms the DPU secret is owned by the signed-in user, checks that the
encrypted secret value is not stored in plaintext, verifies the secret appears
under Explorer `/Confidential/Secrets`, and confirms disconnect removes both the
state record and per-secret ACL entry.

Run it against a local deployment with:

```bash
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_GITHUB=1 \
npm test -- --grep "GitHub token DPU ownership"
```

The same lane also fabricates a pre-delegation, agent-owned token record and
asserts that a fresh store operation deletes the stale record through the
agent-owned compatibility path, then rewrites it as a user-owned DPU secret with
only the configured `gitAgent` read grant. Existing deployments should seed the
matching DPU `agentPolicies` grant before relying on this upgrade path.

## Useful Commands

Run only the default non-external suite:

```bash
npm run test:quick
```

Run against production:

```bash
SMOKE_BASE_URL=https://skills.axiologic.dev npm test
```

Run long relay and media checks:

```bash
SMOKE_OPEN_INTERPRETER=1 SMOKE_WEBMEET_MEDIA=1 npm test
```

Allow known browser noise temporarily while triaging:

```bash
SMOKE_ALLOW_BROWSER_ERRORS=1 npm test
```

## Maintenance Rules

- Prefer stable IDs and data attributes already present in the UI.
- Add a helper under `lib/` before duplicating a flow across specs.
- Keep secret values out of screenshots, traces, console logs, and test annotations.
  Trace attachment must preserve JSON/NDJSON parseability and pass the dynamic
  credential-residue post-scan; environment-secret replacement alone is not
  sufficient.
- External provider checks must stay opt-in unless the repository owns all required credentials and runtime configuration.
- Tests that create rooms, uploads, users, branches, or files must use `SMOKE_RUN_ID` in names and clean up when the UI exposes cleanup.
