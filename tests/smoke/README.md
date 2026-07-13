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

Artifacts are written outside tracked source by default:

```text
../../.ploinky/test-artifacts/headless-smoke/<run-id>/
```

Playwright screenshots, videos, and JSON reports stay under `tests/smoke/test-results/` and `tests/smoke/playwright-report/`. Traces are disabled because Playwright records raw network URLs and cannot redact browser-minted WebMeet credentials from them. Browser-event diagnostics redact sensitive object fields, URL query values, authorization material, generated JWTs, SDP/ICE material, TURN/STUN URLs, private keys, and bounded nested encodings before writing owner-only files.

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
- `SMOKE_WEBMEET_REQUIRE_RELAY=1` additionally requires every selected local ICE candidate to be a TURN relay candidate; it fails fast unless `SMOKE_WEBMEET_MEDIA=1` is also set.
- `SMOKE_WEBMEET_SCREEN=1` is reserved for headless screen-share coverage once the runtime environment supports deterministic display capture.
- `SMOKE_ONLYOFFICE=1` enables DPU/OnlyOffice route checks.
- `SMOKE_NETWORK_TOPOLOGY=1` runs `ploinky network status --json` in `SMOKE_WORKSPACE_ROOT` and proves that the WebMeet signaling, WebMeet TURN, and Office publishing zones contain exactly their intended canonical agent identities; WebTTY, webmeetStt, and Umami each occupy a separate owned default network with only their canonical alias; and the owned running gateway has exactly the `ploinky-router` alias on every managed network. `SMOKE_PLOINKY_BIN` may select a non-default CLI executable.
- `SMOKE_GITHUB=1` enables GitHub plugin authentication checks.

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

Prove WebMeet is using TURN relay candidates in a relay-policy deployment:

```bash
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_WEBMEET_MEDIA=1 \
SMOKE_WEBMEET_REQUIRE_RELAY=1 \
npm test -- --grep "room supports two users"
```

Prove the local rootless trust-zone boundaries after all Explorer dependencies are running:

```bash
SMOKE_NETWORK_TOPOLOGY=1 \
SMOKE_WORKSPACE_ROOT=/absolute/path/to/explorerWorkspace \
npm test -- --grep "rootless network topology"
```

Allow known browser noise temporarily while triaging:

```bash
SMOKE_ALLOW_BROWSER_ERRORS=1 npm test
```

## Maintenance Rules

- Prefer stable IDs and data attributes already present in the UI.
- Add a helper under `lib/` before duplicating a flow across specs.
- Keep secret values out of screenshots, videos, console logs, and test annotations. Do not enable Playwright traces while browser-minted credentials can appear in request URLs.
- External provider checks must stay opt-in unless the repository owns all required credentials and runtime configuration.
- Tests that create rooms, uploads, users, branches, or files must use `SMOKE_RUN_ID` in names and clean up when the UI exposes cleanup.
