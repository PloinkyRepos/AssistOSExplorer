# OnlyOffice Confidential .doc Debug Handoff

Last updated: 2026-06-10

## Status: RESOLVED

The `Download failed.` modal for Explorer-created `.doc` files in `/Confidential/My Space` is fixed. The E2E smoke passes against the fresh deployment.

## Root Cause

The failure was never document-content compatibility and never the storage route. The Document Server converted the seeded RTF successfully every time. The chain was:

| Step | Behavior |
| --- | --- |
| 1 | OnlyOfficeAgent's editor proxy (`onlyOffice/src/index.mjs` forwarders) rewrote the `Host` header to the internal Document Server target (`http://127.0.0.1:80` → `Host: 127.0.0.1`, default port elided by `URL.host`) on both HTTP and WebSocket forwards, and sent no `X-Forwarded-Host`/`X-Forwarded-Proto`. |
| 2 | Document Server nginx (`includes/http-common.conf`) maps `X-Forwarded-Host` → incoming value, falling back to `Host`, so docservice saw the public origin as `127.0.0.1` with no port. |
| 3 | docservice minted the converted-document cache URL over the open WebSocket as `http://127.0.0.1/cache/files/.../Editor.bin?md5=...` (port 80). |
| 4 | The browser fetched that URL, got `net::ERR_CONNECTION_REFUSED` (nothing listens on host port 80), and sdkjs raised `DownloadError` → the `Download failed.` modal over the already-rendered editor shell (`Page 1 of 1` is the empty-shell placeholder, not proof the document loaded). |

Decisive evidence: the failing Playwright trace contained the console error `Failed to load resource: net::ERR_CONNECTION_REFUSED` at `http://127.0.0.1/cache/files/data/<dockey>/Editor.bin/Editor.bin?md5=...` (no port). Document Server docservice/converter logs showed no errors because nothing failed server-side (log level WARN hides routine activity).

## Fix

`onlyOffice/src/proxy/editor-proxy.mjs`: both the HTTP and the WebSocket-upgrade plans now pass `withForwardedHeaders(...)` — preserve incoming `X-Forwarded-Host`/`X-Forwarded-Proto` when an outer proxy set them (Cloudflare tunnel in production sets `X-Forwarded-Proto: https` and preserves `Host`), otherwise fill `X-Forwarded-Host` from the incoming `Host` header and `X-Forwarded-Proto` with `http`. This mirrors the Document Server's own nginx fill-if-absent contract.

Files changed:

| File | Change |
| --- | --- |
| `onlyOffice/src/proxy/editor-proxy.mjs` | Adds `withForwardedHeaders`; applied to HTTP and upgrade plans. |
| `onlyOffice/tests/editor-proxy.test.mjs` | New tests: forwarded headers derived from `Host`, outer-proxy values preserved, no `x-forwarded-host` when request lacks `Host`; existing deepEqual plans updated. |
| `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md` | Editor-plane contract now requires advertising the public origin via forwarded headers. |
| `docs/specs/DS04-onlyoffice-integration.md` | Operational note on the forwarded-header requirement and its failure mode. |
| `onlyOffice/docs/index.html` | One-paragraph summary of the proxy header behavior. |

## Verification (all run 2026-06-10 against the fix)

| Check | Command | Result |
| --- | --- | --- |
| Editor proxy units | `cd onlyOffice && node --test tests/editor-proxy.test.mjs` | 10 pass / 0 fail |
| OnlyOffice agent suite | `cd onlyOffice && npm test` | 61 pass / 6 skipped / 0 fail |
| Focused explorer units | `cd explorer && node --test tests/unit/onlyofficeNewFileContent.test.js tests/unit/fileExpDpuProvider.test.js tests/unit/onlyofficeCutover.test.js` | 14 pass / 0 fail |
| Full explorer suite | `cd explorer && npm test` | 109 pass / 0 fail |
| Agent validator | `node .../validate-ploinky-agent.mjs --agent-dir .../onlyOffice` | PASS, 0 errors, 4 known warnings |
| E2E smoke | Command below, after `rsync` + `ploinky restart` | 1 passed (~21s), twice |
| Mechanism proof | Passing trace (`--trace on`) network log | `GET http://127.0.0.1:8082/cache/files/.../Editor.bin?...` → HTTP 200 |

```bash
cd tests/smoke
SMOKE_ONLYOFFICE=1 \
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_WORKSPACE_ROOT=/Users/danielsava/work/testExplorerFresh \
SMOKE_ACTION_TIMEOUT_MS=60000 \
SMOKE_NAVIGATION_TIMEOUT_MS=120000 \
SMOKE_TEST_TIMEOUT_MS=180000 \
npx playwright test specs/50-onlyoffice-dpu.spec.mjs --project=chromium
```

## Hypotheses Closed

| Hypothesis | Verdict |
| --- | --- |
| Minimal RTF under `.doc` rejected by Document Server | Refuted. x2t converted it; `Editor.bin` was produced in failing runs too. No `.doc` template change needed. |
| Storage route / DPU delegation broken | Refuted. `/internal/document/<token>` served correctly; multiple DPU `callTool` invocations with one delegation grant worked at session creation and read time (the 2026-06 single-use-grant concern did not manifest). |
| `ALLOW_PRIVATE_IP_ADDRESS` / workspace mount issues | Already fixed previously; unrelated to this failure. |
| JWT/session mismatch | Refuted. Editor config was accepted; failure was after open, browser-side. |

## Open Observations (non-blocking)

| Observation | Detail |
| --- | --- |
| Triple session creation | One document open produces three `GET /services/onlyoffice/office/session` calls (smoke's own probe + two from Explorer's preview/open flow) and the editor iframe is instantiated twice ~1.2 s apart (`renderOnlyOfficeEditor` destroy/recreate on config change). Wasteful, possible flake source, but harmless today since all sessions share the content-derived `document.key`. |
| Sharp module warning | Document Server logs `Sharp module failed to load` on arm64 at startup; image processing limited. Pre-existing, unrelated. |
| DS log level | docservice/converter log at WARN; raise log4js level when debugging server-side behavior. |

## Fresh Deployment Recipe

Unchanged:

```bash
cd /Users/danielsava/work/testExplorerFresh
ploinky destroy
rm -rf .ploinky
ploinky start explorer
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.ploinky/' \
  --exclude='node_modules/' \
  --exclude='tests/smoke/node_modules/' \
  /Users/danielsava/work/file-parser/AssistOSExplorer/ \
  /Users/danielsava/work/testExplorerFresh/.ploinky/repos/AchillesIDE/
ploinky restart
```
