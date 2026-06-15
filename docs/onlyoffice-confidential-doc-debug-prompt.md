# Continuation Prompt: OnlyOffice Confidential .doc Debugging

You are working in `/Users/danielsava/work/file-parser`, a multi-repo workspace. Read `/Users/danielsava/work/file-parser/CLAUDE.md` and `/Users/danielsava/work/file-parser/AssistOSExplorer/CLAUDE.md` first. Work in the original repo, not `.ploinky/repos`, except when copying local changes into the fresh deployment for testing.

Primary handoff:

```text
/Users/danielsava/work/file-parser/AssistOSExplorer/docs/onlyoffice-confidential-doc-debug-handoff.md
```

## Task

Continue debugging the local E2E failure for Explorer-created `.doc` files in `/Confidential/My Space`. The current E2E smoke creates a `.doc` through the Explorer UI, verifies the DPU encrypted object and OnlyOffice session, opens the editor, and then fails because OnlyOffice shows `Download failed`.

Do not assume the previous fixes are sufficient. Verify every claim from the handoff with local commands before changing behavior.

## Current Important Facts

| Fact | Evidence |
| --- | --- |
| OnlyOfficeAgent is running as the custom image | `podman ps` shows `docker.io/assistos/onlyoffice-agent:9.3.1`. |
| Private loopback fetches are enabled | OnlyOffice container has `ALLOW_PRIVATE_IP_ADDRESS=true`; `/etc/onlyoffice/documentserver/local.json` has `request-filtering-agent.allowPrivateIPAddress=true`. |
| Metadata IP fetches remain disabled | `ALLOW_META_IP_ADDRESS` is unset. |
| OnlyOfficeAgent has workspace-root access | Explorer enables `onlyOffice global`; container has `PLOINKY_WORKSPACE_ROOT=/Users/danielsava/work/testExplorerFresh` and the directory is mounted. |
| DPU object creation works | Latest failing run created object `98a080be-cb7e-4758-a2c6-bde38096d2da` with `mimeType: application/msword`. |
| Internal document URL works | `curl` inside OnlyOffice container to `/internal/document/J2uPsCm3dzn8Pap_-d72KT8hy0pwvxL0NbHPQ2IpuOo` returned HTTP 200, `application/msword`, 71 bytes of RTF. |
| E2E still fails | Smoke frame text contains `Page 1 of 1` and then `Error / Download failed`. |

## Files To Inspect First

```text
/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/services/onlyoffice/onlyoffice-new-file-content.js
/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/web-components/pages/file-exp/file-exp-fs-actions.js
/Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke/specs/50-onlyoffice-dpu.spec.mjs
/Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice/src/routes/control.mjs
/Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice/src/routes/storage.mjs
/Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice/src/storage/dpu-store.mjs
/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/manifest.json
/Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice/manifest.json
```

## Reproduce

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
SMOKE_ONLYOFFICE=1 \
SMOKE_BASE_URL=http://127.0.0.1:8080 \
SMOKE_WORKSPACE_ROOT=/Users/danielsava/work/testExplorerFresh \
SMOKE_ACTION_TIMEOUT_MS=60000 \
SMOKE_NAVIGATION_TIMEOUT_MS=120000 \
SMOKE_TEST_TIMEOUT_MS=180000 \
npx playwright test specs/50-onlyoffice-dpu.spec.mjs --project=chromium
```

Artifacts land under:

```text
/Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke/test-results/50-onlyoffice-dpu-DPU-and--7d98c-DPU-and-opens-in-OnlyOffice-chromium/
```

## Fresh Deployment Sync

If you change source files and need to test them in the running Ploinky deployment:

```bash
cd /Users/danielsava/work/testExplorerFresh
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.ploinky/' \
  --exclude='node_modules/' \
  --exclude='tests/smoke/node_modules/' \
  /Users/danielsava/work/file-parser/AssistOSExplorer/ \
  /Users/danielsava/work/testExplorerFresh/.ploinky/repos/AchillesIDE/
ploinky restart
```

For a full clean deployment:

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

## Suggested Investigation

The strongest current hypothesis is that OnlyOffice does not accept the minimal RTF payload being served as `.doc`. Test this directly:

| Experiment | Expected learning |
| --- | --- |
| Replace the `.doc` seed with a real blank binary `.doc` template | If the smoke passes, the fix is to ship or generate a valid `.doc` template. |
| Run the same smoke with `.docx` and a valid blank DOCX template | Separates DPU/OnlyOffice routing from legacy `.doc` conversion behavior. |
| Replay the internal document URL after each session | Confirms the storage route returns the expected MIME type, byte length, and magic bytes. |
| Inspect OnlyOffice converter/docservice logs around the failed session | Look for conversion or post-load download errors. |

Useful replay command after extracting a session token from the Playwright trace:

```bash
podman exec ploinky_AchillesIDE_onlyOffice_testExplorerFresh_d8f88a10 \
  sh -lc 'curl -sS -D /tmp/doc.headers -o /tmp/doc.bin http://127.0.0.1:9100/internal/document/<TOKEN>; cat /tmp/doc.headers; wc -c /tmp/doc.bin; xxd -l 128 /tmp/doc.bin'
```

## Verification Expectations

Before reporting success, run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
node --test tests/unit/onlyofficeNewFileContent.test.js tests/unit/fileExpDpuProvider.test.js tests/unit/onlyofficeCutover.test.js
npm test
```

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
npm test
node /Users/danielsava/work/file-parser/.agents/skills/manage-ploinky-agents/scripts/validate-ploinky-agent.mjs --agent-dir /Users/danielsava/work/file-parser/AssistOSExplorer/onlyOffice
```

Then sync to `/Users/danielsava/work/testExplorerFresh`, restart Ploinky, and rerun the smoke command above. The smoke must fail if the editor displays `Download failed`, even if the editor shell renders.

