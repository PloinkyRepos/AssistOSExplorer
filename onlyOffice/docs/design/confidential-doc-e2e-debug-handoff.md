# Confidential `.doc` E2E Debug Handoff

## Purpose

Resume debugging the local end-to-end flow:

1. Browser opens Explorer.
2. Explorer creates a `.doc` under `/Confidential/My Space`.
3. The file is stored in `dpuAgent` encrypted-at-rest storage.
4. Selecting/opening the file requests an OnlyOffice session through the Ploinky router at `/services/onlyoffice/office/session`.
5. OnlyOfficeAgent returns a signed editor config and later persists changes back to `dpuAgent`.

Current result: steps 1-3 pass. Step 4 fails with `404` because Ploinky routes `/services/onlyoffice/*` to the OnlyOffice editor proxy port, not the OnlyOfficeAgent control port.

## Workspace And Runtime State

Primary source workspace:

```text
/Users/danielsava/work/file-parser
```

Disposable local runtime workspace used for this run:

```text
/Users/danielsava/work/testExplorerFresh
```

Runtime was deployed from scratch with the user-requested flow:

```bash
cd /Users/danielsava/work/testExplorerFresh
ploinky destroy
rm -rf .ploinky
ploinky start explorer
rsync -a --delete --exclude='.git/' --exclude='node_modules/' --exclude='.DS_Store' \
  /Users/danielsava/work/file-parser/AssistOSExplorer/ \
  /Users/danielsava/work/testExplorerFresh/.ploinky/repos/AchillesIDE/
ploinky restart
```

Local router:

```text
http://127.0.0.1:8080
```

Default local credentials:

```text
admin/admin
user/user
```

Relevant running containers from `ploinky status`:

```text
ploinky_AchillesIDE_explorer_testExplorerFresh_d8f88a10
ploinky_AchillesIDE_dpuAgent_testExplorerFresh_d8f88a10
ploinky_AchillesIDE_onlyOffice_testExplorerFresh_d8f88a10
```

OnlyOffice image in the running deployment:

```text
docker.io/assistos/onlyoffice-agent:9.3.1
```

## Automated Smoke Tests Found

Executable smoke tests live under:

```text
/Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
```

Smoke instructions:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
npm ci
npm run install:browsers
SMOKE_BASE_URL=http://127.0.0.1:8080 npm test
```

OnlyOffice/DPU opt-in smoke:

```bash
SMOKE_BASE_URL=http://127.0.0.1:8080 SMOKE_ONLYOFFICE=1 \
  npx playwright test specs/50-onlyoffice-dpu.spec.mjs
```

Observed result:

```text
FAILED: specs/50-onlyoffice-dpu.spec.mjs
Expected [200, 400], received 404
```

Reason the smoke is stale: `AssistOSExplorer/tests/smoke/specs/50-onlyoffice-dpu.spec.mjs` still calls:

```text
/services/explorer/office/session?path=/Confidential/My%20Space/smoke-placeholder.doc
```

The new architecture moved the protected session route to:

```text
/services/onlyoffice/office/session?path=...
```

This smoke test also does not create a `.doc` and does not verify DPU backing storage.

## Manual Browser E2E Performed

Created a document through the Explorer UI, not by mutating DPU state directly.

Path:

```text
/Confidential/My Space/e2e-confidential-20260609170024.doc
```

How it was created:

1. Logged in to `http://127.0.0.1:8080/dashboard` as `admin/admin`.
2. Opened:

   ```text
   http://127.0.0.1:8080/explorer/index.html#file-exp/Confidential/My%20Space
   ```

3. Clicked the Explorer toolbar `New` menu.
4. Chose `New File`.
5. Accepted the browser prompt with:

   ```text
   e2e-confidential-20260609170024.doc
   ```

Explorer page state after creation:

```json
{
  "path": "/Confidential/My Space",
  "selectedPath": "/Confidential/My Space/e2e-confidential-20260609170024.doc",
  "entry": {
    "name": "e2e-confidential-20260609170024.doc",
    "type": "file",
    "path": "/Confidential/My Space/e2e-confidential-20260609170024.doc",
    "virtualProvider": "dpu"
  }
}
```

Browser request evidence showed repeated successful calls to:

```text
POST http://127.0.0.1:8080/dpuAgent/mcp
```

Selecting the file then requested:

```text
GET http://127.0.0.1:8080/services/onlyoffice/office/session?path=%2FConfidential%2FMy+Space%2Fe2e-confidential-20260609170024.doc
```

Observed response:

```text
404
```

## DPU Storage Verification

DPU data root in the running container:

```text
DPU_DATA_ROOT=/dpu-data
```

Mounted to host:

```text
/Users/danielsava/work/testExplorerFresh/.ploinky/data/dpu-data -> /dpu-data
```

DPU state contains the created file:

```json
{
  "id": "dbd02091-854c-4109-b07b-154d5ff12a3e",
  "name": "e2e-confidential-20260609170024.doc",
  "type": "file",
  "parentId": "d90e0ab5-421e-4ab0-950d-3d9b807a7e50",
  "ownerId": "user:local:admin",
  "mimeType": "",
  "createdAt": "2026-06-09T17:00:27.055Z",
  "updatedAt": "2026-06-09T17:00:27.055Z"
}
```

Encrypted blob exists:

```text
/Users/danielsava/work/testExplorerFresh/.ploinky/data/dpu-data/blobs/dbd02091-854c-4109-b07b-154d5ff12a3e
```

Blob inspection:

```text
size: 50 bytes
prefix: DPUENC1
contains plaintext filename: false
contains plaintext marker: false
```

No normal filesystem copy of the `.doc` was found under:

```text
/Users/danielsava/work/testExplorerFresh
```

Conclusion: Explorer creates the Confidential `.doc` through DPU and DPU stores it encrypted at rest.

## OnlyOffice Routing Failure

Direct editor host probe works:

```bash
curl -i http://127.0.0.1:8082/web-apps/apps/api/documents/api.js
```

Observed:

```text
HTTP/1.1 200 OK
```

Router session request without browser auth redirects to login:

```bash
curl -i 'http://127.0.0.1:8080/services/onlyoffice/office/session?path=%2FConfidential%2FMy%20Space%2Fe2e-confidential-20260609170024.doc'
```

Observed:

```text
HTTP/1.1 302 Found
Location: /auth/login?returnTo=...
```

Browser-authenticated Explorer request to the same route returned `404`, not `401` or `403`.

Direct host port probes:

```bash
curl -i 'http://127.0.0.1:8082/control/office/session?path=%2FConfidential%2FMy%20Space%2Fe2e-confidential-20260609170024.doc'
```

Observed:

```text
HTTP/1.1 404 Not Found
```

Inside the OnlyOfficeAgent container:

```bash
podman exec ploinky_AchillesIDE_onlyOffice_testExplorerFresh_d8f88a10 \
  sh -lc 'curl -i "http://127.0.0.1:7000/control/office/session?path=%2FConfidential%2FMy%2520Space%2Fe2e-confidential-20260609170024.doc" | sed -n "1,8p"'
```

Observed:

```text
HTTP/1.1 401 Unauthorized
Content-Type: application/json
...
{"ok":false,"error":"invalid_http_service_auth",...}
```

This proves the control route exists on container port `7000`. It returns `401` only because the direct in-container curl lacks the router-issued HTTP service invocation headers. That is expected.

Container listeners:

```text
0.0.0.0:7000   control server
127.0.0.1:9100 storage callback/document server
0.0.0.0:8080   editor proxy
0.0.0.0:80     stock Document Server nginx
```

Relevant source:

```text
AssistOSExplorer/onlyOffice/src/index.mjs
  controlServer listens on config.controlPort, default 7000
  storageServer listens on config.storagePort, default 9100, loopback only
  editorServer listens on config.editorPort, default 8080
```

Relevant manifest:

```json
{
  "httpServices": [
    {
      "externalPrefix": "/services/onlyoffice/",
      "internalPrefix": "/control/",
      "auth": "protected"
    }
  ],
  "profiles": {
    "default": {
      "ports": [
        "127.0.0.1:8082:8080"
      ]
    }
  }
}
```

Runtime routing:

```json
{
  "routes": {
    "onlyOffice": {
      "hostPort": 8082
    }
  }
}
```

Likely root cause: Ploinky's HTTP service proxy maps `/services/onlyoffice/*` to `route.hostPort`. For `onlyOffice`, `route.hostPort` is `8082`, which maps to the editor proxy on container port `8080`. Therefore the router rewrites `/services/onlyoffice/office/session` to `/control/office/session` but sends it to the editor proxy, which returns `404`. The actual control route is on container port `7000`, but that port is not the route host port and is not host-published for router use.

## Source References To Inspect

Explorer creation path:

```text
AssistOSExplorer/explorer/web-components/pages/file-exp/file-exp-fs-actions.js
  newFile() prompts for a filename
  if current path is DPU-managed, it calls createDpuFile(..., { content: "" })
```

```text
AssistOSExplorer/explorer/web-components/pages/file-exp/file-exp-dpu-provider.js
  createDpuFile() calls dpu_confidential_create with parentId, type=file, name, content, mimeType
```

OnlyOffice control route:

```text
AssistOSExplorer/onlyOffice/src/routes/control.mjs
  handles GET /control/office/session
  verifies router HTTP service auth headers
  requires dpuConfidential delegation for /Confidential paths
```

OnlyOffice listeners:

```text
AssistOSExplorer/onlyOffice/src/index.mjs
  listen(controlServer, config.controlPort, "0.0.0.0")
  listen(storageServer, config.storagePort, "127.0.0.1")
  listen(editorServer, config.editorPort, "0.0.0.0")
```

OnlyOffice manifest:

```text
AssistOSExplorer/onlyOffice/manifest.json
  httpServices: /services/onlyoffice/ -> /control/, auth protected
  default profile publishes 127.0.0.1:8082:8080
```

Ploinky HTTP service routing:

```text
ploinky/cli/server/httpServiceRoutes.js
ploinky/cli/server/routerHandlers.js
ploinky/cli/server/RoutingServer.js
ploinky/cli/services/docker/agentServiceManager.js
```

Focus on how `route.hostPort` is chosen when an agent has explicit `ports` and also `httpServices`.

## Recommended Debugging Plan

1. Reproduce quickly:

   ```bash
   cd /Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
   SMOKE_BASE_URL=http://127.0.0.1:8080 SMOKE_ONLYOFFICE=1 \
     npx playwright test specs/50-onlyoffice-dpu.spec.mjs
   ```

2. Fix or redesign OnlyOfficeAgent port routing:

   - The protected control service `/services/onlyoffice/office/session` must reach container port `7000`.
   - The public editor asset/WebSocket surface must still reach the editor proxy on container port `8080`.
   - The storage listener on `9100` must remain loopback-only and not router-reachable.

3. Decide the correct Ploinky/runtime model:

   - Option A: teach Ploinky `httpServices` to target a service-specific container/host port, not only `route.hostPort`.
   - Option B: make the OnlyOfficeAgent route host port be the control port and expose the editor proxy through a separate route/service/public port mechanism.
   - Option C: run one public facade listener that routes `/control/*` internally to the control handler and allowed editor paths to the editor proxy, while still keeping `/internal/*` off that listener. Be careful: the architecture intentionally separates public editor and protected control tiers.

4. Update the automated smoke test:

   - Create a unique `.doc` in `/Confidential/My Space` through Explorer UI.
   - Assert DPU state contains the file and a `DPUENC1` blob exists.
   - Assert no workspace filesystem copy exists.
   - Select/open the file and assert `/services/onlyoffice/office/session` returns `200` with `preview.storageKind === "dpu"`.
   - Assert the old `/services/explorer/office/session` path is no longer used.

5. After fixing routing, run:

   ```bash
   cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
   npm test

   cd /Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
   SMOKE_BASE_URL=http://127.0.0.1:8080 SMOKE_ONLYOFFICE=1 \
     npx playwright test specs/50-onlyoffice-dpu.spec.mjs
   ```

6. Re-run a fresh deployment:

   ```bash
   cd /Users/danielsava/work/testExplorerFresh
   ploinky destroy
   rm -rf .ploinky
   ploinky start explorer
   rsync -a --delete --exclude='.git/' --exclude='node_modules/' --exclude='.DS_Store' \
     /Users/danielsava/work/file-parser/AssistOSExplorer/ \
     /Users/danielsava/work/testExplorerFresh/.ploinky/repos/AchillesIDE/
   ploinky restart
   ```

## Guardrails

- Do not print or commit secret values. When checking env, print presence/equality only.
- Do not route `/internal/document/*` or `/internal/callback/*` through the Ploinky router.
- Do not give OnlyOfficeAgent `PLOINKY_MASTER_KEY`, `PLOINKY_DERIVED_MASTER_KEY`, `DPU_MASTER_KEY`, or any other agent secret.
- Preserve B2 delegation: Confidential Office operations must be evaluated by `dpuAgent` as the original user, with OnlyOfficeAgent as the delegated caller.
- The existing untracked file `explorer-diagram.md` was present before this handoff was created; do not overwrite or assume ownership of it.

## Short Verdict

DPU Confidential file creation from Explorer works and stores an encrypted blob in dpuAgent. The current blocker is the OnlyOfficeAgent protected session route: it is implemented on container port `7000`, but the Ploinky route points to host port `8082`, which maps to the editor proxy on container port `8080`. Fix the control/editor port routing split, then upgrade the OnlyOffice smoke test from a stale route probe into a true create-store-open E2E.
