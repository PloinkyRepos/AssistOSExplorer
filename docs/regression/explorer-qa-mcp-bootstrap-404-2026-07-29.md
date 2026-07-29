# Explorer QA MCP Bootstrap 404

## Status

Confirmed two-layer defect on 2026-07-29. A QA harness URL error first hid a
Ploinky route-plan defect. Together they blocked both required Explorer QA
acceptance cases before their application-specific steps began.

## Environment

| Field | Value |
| --- | --- |
| Deployment | Fresh `ploinky-proxy` graph |
| Public origin | `https://explorer-qa.axiologic.dev` |
| Browser | Headless Chromium 140.0.7339.16 via Playwright 1.60.0 |
| Authentication | Explorer administrator login succeeds |
| Test | `tests/smoke/specs/80-explorer-qa-acceptance.spec.mjs` |

## Expected

After administrator authentication, the QA harness should open Explorer at the
public agent root, bootstrap its routed MCP client through `/mcp`, render
`#page_content`, and allow the test to create the two run-scoped users used by
the OnlyOffice and WebMeet cases.

## Actual

The first failure was in the harness: it opened the local-development Explorer path
`/explorer/index.html` on the public agent-root hostname. Explorer then derived
`/explorer/explorer/mcp`, which correctly returned HTTP 404 because the public
deployment exposes the supported `agent-mcp` surface at `/mcp`. The
application displayed:

```text
Explorer failed to load
MCP request failed: HTTP 404 - Not Found
```

`#page_content` remained present but hidden and empty, so the acceptance setup
could not open Administration. The failure was reproducible after a successful
administrator login and was neither an authentication, browser-DNS, nor QA
deployment routing failure.

After correcting the QA entry point to the public root, Explorer reached
`/mcp` but its valid dependency MCP calls still returned 404. Explorer calls
paths including:

```text
/dpuAgent/mcp
/onlyOffice/mcp
/webmeetAgent/mcp
```

Ploinky's documented `agent-mcp` surface promises MCP routing for the selected
application's enabled dependency closure, but the implementation admitted only
root `/mcp`. This second failure is a Ploinky route-plan defect.

## Reproduction

```bash
cd tests/smoke
SMOKE_USERNAME=admin \
SMOKE_PASSWORD='<qa-admin-password>' \
SMOKE_QA_EDGE_IP='<current-public-cloudflare-ipv4>' \
npm run test:qa
```

The first test fails in `openExplorer` while waiting for `#page_content` to
become visible. Because the suite is serial and user creation happens in
`beforeAll`, both application-specific cases are blocked.

## Evidence

The Playwright JSON result records:

```text
tests/smoke/test-results/results.json
```

The failure snapshot and screenshot are under the corresponding
`80-explorer-qa-acceptance-*` result directory. The snapshot shows the visible
MCP 404 dialog. Runtime artifacts are intentionally not committed because they
can contain environment-specific diagnostics.

## Root Cause And Fix Boundary

The fix has two scoped parts:

1. The QA-only harness must navigate to the public Explorer root and preserve
   the existing `/explorer/index.html` behavior for ordinary local smoke
   profiles.
2. Ploinky must derive a closed MCP allowlist from the selected root app and
   its manifest-enabled dependency closure. It must expose each admitted
   dependency's MCP endpoint without exposing arbitrary agent content or
   unrelated agents.

The tests must continue using the public hostname and Router; they must not add
a browser bypass, duplicate broad deployment route, or weakened assertion.

After the harness fix, rerun `npm run test:qa`. The overall release gate is
closed only when both the Confidential `.doc` OnlyOffice/autosave case and the
two-user WebMeet room/chat case pass against the public QA origin.
