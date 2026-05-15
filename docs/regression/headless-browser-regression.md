# Headless Browser Regression Cases

This runbook defines the complex browser regression surface for Explorer and its coupled agents. Use it when changing GitHub auth, DPU Confidential files, OnlyOffice document editing, Git sync, account/session behavior, WebMeet rooms, LiveKit media, chat, or screen sharing.

## Baseline Workspace

Run the suite against a fresh workspace unless the change being tested requires a specific fixture:

```bash
mkdir -p ~/work/testExplorerFresh
cd ~/work/testExplorerFresh
ploinky destroy || true
find "$PWD" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
ploinky start explorer
ploinky status
```

Use the router URL reported by Ploinky, normally:

```text
http://127.0.0.1:8080
```

The default local profile provides `admin` / `admin` and `user` / `user`. Tests that create additional users must use generated names such as `e2e-owner-<run-id>` and `e2e-member-<run-id>`, then delete or disable those users during cleanup when the UI exposes that action.

Keep browser traces, videos, screenshots, OAuth storage state, and generated test files outside tracked source. Prefer `.ploinky/test-artifacts/headless-regression/<run-id>/` inside the disposable workspace.

## Browser Harness

The maintainable Playwright suite lives in `tests/smoke/`. Use it for the automated baseline before or after any manual exploration:

```bash
cd tests/smoke
npm ci
npm run install:browsers
SMOKE_BASE_URL=http://127.0.0.1:8080 npm test
```

The suite records traces, videos, screenshots, browser console events, failed requests, and upload/session evidence outside tracked source. See `tests/smoke/README.md` for flags such as `SMOKE_OPEN_INTERPRETER=1`, `SMOKE_WEBMEET_MEDIA=1`, `SMOKE_ONLYOFFICE=1`, and `SMOKE_GITHUB=1`.

Use Playwright Chromium or the Codex browser automation surface with an isolated browser context per Explorer account. For media tests, launch Chromium with fake media devices:

```js
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--allow-http-screen-capture',
    '--auto-select-desktop-capture-source=Entire screen'
  ]
});
```

Grant camera and microphone permissions for the router origin in each context. Record console errors, failed network requests, screenshots, and traces for every failed step.

Screen sharing is browser-environment sensitive. If headless Chromium rejects `navigator.mediaDevices.getDisplayMedia` before the application code runs, rerun that WebMeet case in headed Chromium or under a virtual display. Treat it as an environment skip only when room creation, two-user join, camera, and chat pass and the failure is clearly a browser capture limitation rather than an application error.

## Shared Login And Account Steps

1. Open `/dashboard` through the Ploinky router.
2. If redirected to login, submit the configured username and password.
3. Assert the dashboard or Explorer shell loads without direct-agent URLs.
4. For account-creation coverage, log in as `admin`, open the Explorer account/admin menu, create `e2e-owner-<run-id>` and `e2e-member-<run-id>`, then verify both accounts can log in through separate browser contexts.
5. If the account creation UI is unavailable in the active profile, record that as a product gap for this regression. Do not silently replace it with a direct database or container mutation.

## Case 1: GitHub OAuth For Git Agent

Purpose: verify that GitHub authentication works through the Git plugin and that OAuth credentials remain secret-owned.

Preconditions:

- `gitAgent` is running as part of `ploinky start explorer`.
- The test is allowed to use a GitHub test account.
- For fully automated completion, provide a Playwright storage state for the GitHub test account outside the repository. Without that, this case may be run as a human-assisted device-flow test.

Steps:

1. Log in to Explorer as `e2e-owner-<run-id>` or `admin`.
2. Open the Explorer UI and press the Git toolbar button.
3. Open the GitHub authentication action in the Git modal.
4. Start the GitHub OAuth/device flow.
5. Assert the UI displays a GitHub verification URI and a device code.
6. Complete the device flow in a separate context using the pre-authenticated GitHub storage state, or have a tester enter the device code manually.
7. Poll from the Git modal until it reports a connected GitHub identity.
8. Refresh the Git modal and assert the connected state persists for the same Explorer user.
9. Inspect browser storage, console output, and captured network payloads for this run. The GitHub access token must not appear in localStorage, sessionStorage, URLs, visible UI text, screenshots, or non-debug logs.
10. Disconnect the GitHub test account for this Explorer user if the UI exposes that action.

Pass criteria:

- GitHub auth starts and completes through the routed Git plugin UI.
- The connected identity survives a page refresh.
- The access token stays in the DPU-backed secret store or equivalent secret boundary, not in browser-visible state.

Skip criteria:

- GitHub blocks automation with CAPTCHA, 2FA, or device-flow risk controls. Record the device-flow start, the blocking reason, and whether a human-assisted run completed.

## Case 2: Confidential `.doc` Creation Through DPU And OnlyOffice

Purpose: verify that creating and editing an Office document in `/Confidential` exercises both the DPU Confidential store and the OnlyOffice editor path.

Steps:

1. Log in as `e2e-owner-<run-id>` or `admin`.
2. Open Explorer and navigate to `/Confidential/My Space`.
3. Use the New action to create `e2e-confidential-<run-id>.doc`.
4. Assert the new file appears under `/Confidential/My Space` without a normal host filesystem path being exposed in the UI.
5. Select the `.doc` file.
6. Assert the preview/editor pane requests OnlyOffice through the Ploinky router and loads the OnlyOffice API script successfully.
7. Fail immediately on any visible or console error containing:
   - `ONLYOFFICE_PUBLIC_URL is not configured`
   - `Failed to load OnlyOffice API script`
   - `OnlyOffice editor mount failed`
   - HTTP 401/403/404/5xx for the OnlyOffice API script, document download route, or callback route
8. Wait for the OnlyOffice editor frame or ready state.
9. Type a unique marker such as `confidential-doc-e2e-<run-id>` into the document.
10. Wait for OnlyOffice to report saved state or for the callback route to complete successfully.
11. Reload Explorer, reopen the file, and assert the marker persists.
12. Log in as `e2e-member-<run-id>` in a separate browser context and verify the Confidential object is not visible unless it was explicitly shared.

Pass criteria:

- `.doc` creation produces a document that OnlyOffice can open, not an empty or invalid legacy document.
- OnlyOffice uses profile defaults from `ploinky start explorer`; no manual `ploinky var` setup is required for local default/dev profiles.
- DPU ACL behavior is preserved across browser contexts.

## Case 3: `.ploinky` Repository Document Change And Git Sync

Purpose: verify that Explorer can edit a documentation file in a repo under `.ploinky/repos`, the Git plugin detects the change, and Sync pushes through the authenticated Git path.

Preconditions:

- GitHub OAuth from Case 1 is connected for the test user.
- The target repo is disposable or uses a disposable test branch.
- To validate Ploinky core specifically, ensure `.ploinky/repos/ploinky` exists in the fresh workspace. If the Ploinky repo is not enabled, fail this Ploinky-specific case as missing setup instead of substituting a different repo silently.

Steps:

1. Log in as the GitHub-connected test user.
2. Open Explorer at `/.ploinky/repos/ploinky/docs/` and select a small Markdown or HTML documentation file.
3. Create or switch to a branch named `e2e/headless-<run-id>` from the Git UI.
4. Make a minimal reversible edit, for example add `<!-- e2e sync <run-id> -->` to the selected document.
5. Save the file from Explorer.
6. Open the Git modal and select the `ploinky` repo.
7. Assert the changed file appears in the repo tree and the diff contains the unique marker.
8. Run Sync from the Git modal.
9. Assert Sync completes without credential prompts, rejected pushes, stale-body-hash errors, or raw MCP errors.
10. Verify the remote branch contains the marker with `git ls-remote` plus a fetch or through the GitHub UI/API for the test repository.
11. Clean up by reverting the marker or deleting the disposable branch.

Pass criteria:

- Explorer edits a file below `.ploinky/repos/ploinky`.
- Git diff detection and Sync operate on the intended repo.
- Sync uses the GitHub-authenticated path and does not expose credentials in the browser.

## Case 4: WebMeet Two-Account Room, Camera, Screen Share, And Chat

Purpose: verify that WebMeet works end to end with two Explorer accounts, routed WebMeet HTTP services, LiveKit media, and chat.

Preconditions:

- `webmeetAgent` and `webmeetInfra` services are running from `ploinky start explorer`.
- Two Explorer accounts exist from the shared account steps.
- Browser contexts are launched with fake camera and microphone devices.

Instrumentation:

Install a small init script before each page loads so the test can inspect WebRTC state without changing application code:

```js
await context.addInitScript(() => {
  const NativeRTCPeerConnection = window.RTCPeerConnection;
  window.__e2ePeerConnections = [];
  window.RTCPeerConnection = function (...args) {
    const pc = new NativeRTCPeerConnection(...args);
    window.__e2ePeerConnections.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = NativeRTCPeerConnection.prototype;
});
```

Steps:

1. Create two browser contexts: context A for `e2e-owner-<run-id>` and context B for `e2e-member-<run-id>`.
2. Log both users in through `/dashboard`.
3. In context A, open Explorer and press the WebMeet toolbar button.
4. Create a room named `e2e-room-<run-id>`.
5. Join the room as user A.
6. In context B, open the same WebMeet surface and join `e2e-room-<run-id>`.
7. Assert both pages show the same room name and at least two participants.
8. Enable microphone and camera for both users.
9. Assert each page has an active local video element and at least one remote video element with `readyState >= 2`, `videoWidth > 0`, and `videoHeight > 0`.
10. Collect WebRTC stats from `window.__e2ePeerConnections` in both pages and assert outbound and inbound RTP packet counters increase over two consecutive samples.
11. Send chat message `chat-from-owner-<run-id>` from context A and assert it appears in context B.
12. Send chat message `chat-from-member-<run-id>` from context B and assert it appears in context A.
13. As an admin, attach the LiveKit assistant agent (`assistant_on_mention` / `on_mention`) and assert the response includes a real LiveKit participant with `kind=AGENT` and WebMeet attributes for meeting id, agent type, and mode.
14. Send an `@WebMeetAgent` chat mention and record whether the worker responds; a missing response is a provider/configuration failure, not proof of successful dispatch.
15. As an admin, attach the LiveKit scribe agent (`scribe` / `post_event`) while at least one microphone is publishing a speech-like test audio file.
16. Poll `webmeet_transcript_list` until at least one scribe-sourced transcript segment is persisted for the meeting.
17. Start screen sharing from context A.
18. Assert context A shows a local screen-share state and context B receives a new remote screen-share track or a second remote video stream with increasing inbound video frames.
19. Stop screen sharing, leave the room from both contexts, and delete the test room if the UI exposes room deletion.

Pass criteria:

- Room creation and join happen through the WebMeet UI, not direct service ports.
- Two different authenticated Explorer accounts can join the same room.
- Camera media flows both directions.
- Chat delivery is visible in both contexts.
- Assistant and scribe attachments create real LiveKit `AGENT` participants, not store-only simulated presence.
- The scribe attachment produces persisted transcript segments from microphone audio.
- Screen sharing either succeeds and produces a remote track, or is explicitly skipped because the browser capture environment does not support headless display capture.

## Case 5: Copilot And WebMeet Tagged Open Interpreter Chat

Purpose: verify that the Ploinky Copilot WebChat and the Explorer WebMeet chat both expose the new `@` autocomplete behavior and can dispatch `@open-interpreter` prompts through the research relay without exposing provider secrets to the browser.

Preconditions:

- `AchillesCLI/achilles-cli`, `copilot-agents/research-agents`, `copilot-agents/researchRelay`, and `copilot-agents/openInterpreterAgent` are enabled in the workspace.
- `SOUL_GATEWAY_API_KEY` is available to Ploinky as a workspace secret or process environment value. Do not require `SOUL_GATEWAY_BASE_URL` for the normal local smoke.
- The Open Interpreter runtime may need a first-run preparation window. Use timeouts long enough for a cold runtime, for example 420 seconds for tagged relay responses.
- Create a small workspace fixture such as `e2e-headless-note-<run-id>.txt` in the disposable workspace root so file/folder suggestions have a deterministic target.

Copilot WebChat steps:

1. Open the routed WebChat URL for AchillesCLI with the tag-relay parameters:

   ```text
   /webchat?agent=achilles-cli&research-tags=1&forward-envelope=1&tag-relay-agent=researchRelay&tag-relay-submit-tool=research_task_submit&tag-relay-list-tool=research_relay_list_backends&tag-relay-tags=open-interpreter&workspace-dir=.
   ```

2. Type `@e2e-headless-note-<run-id-prefix>` into the composer and assert the suggestion menu includes a `Files and folders` group containing the fixture file.
3. Type `@op` and assert the suggestion menu includes an `Agents` group with `@open-interpreter`.
4. Select `@open-interpreter` with Enter, Tab, or pointer input and assert the composer value becomes `@open-interpreter `.
5. Assert the composer renders the selected mention with the WebChat mention-highlight element while preserving textarea editing and caret behavior.
6. Send `@open-interpreter Reply with exactly WEBCHAT_E2E_OK and no other words.`
7. Assert the sent WebChat message keeps `@open-interpreter` visually emphasized, and wait for an assistant response containing `WEBCHAT_E2E_OK`.

WebMeet chat steps:

1. Open Explorer at `/explorer/index.html`, not by directly cold-loading the WebMeet hash route.
2. Press the WebMeet toolbar button and use the resulting WebMeet page or tab.
3. Create and join `e2e-room-<run-id>`.
4. Type `@e2e-headless-note-<run-id-prefix>` into `#webmeetChatInput` and assert the suggestion menu includes a `Files and folders` group containing the fixture file.
5. Type `@op` and assert the suggestion menu includes an `Agents` group with `@open-interpreter`.
6. Select `@open-interpreter` and assert the input value becomes `@open-interpreter `.
7. Assert the WebMeet composer renders the selected mention with the WebMeet mention-highlight element while preserving the underlying textarea, send-on-Enter shortcut, and `webmeet_chat_send` path.
8. Send `@open-interpreter Reply with exactly WEBMEET_E2E_OK and no other words.` Use the UI send path, not a direct MCP call.
9. Because WebMeet waits for `webmeet_chat_send` to finish before refreshing the chat list, wait for the relay result before treating the missing sent message as a failure.
10. Assert the chat list contains the sent `@open-interpreter` message in bold and a relay response containing `WEBMEET_E2E_OK`.

Pass criteria:

- Both surfaces show `Agents` and `Files and folders` groups for `@` suggestions.
- Selecting `@open-interpreter` inserts exactly one canonical tag with a trailing space.
- Sent messages keep known agent tags visually emphasized after submission.
- Both surfaces dispatch to Open Interpreter through the configured research relay and receive the expected marker response.
- Browser logs, screenshots, network payloads, and artifacts do not contain Soul Gateway keys, DockerHub tokens, local auth passwords, invocation JWTs, prompt bodies beyond the explicit test messages, or other provider credentials.

## Reporting

Every run should record:

- Workspace path and router URL.
- Git commit SHAs for `AssistOSExplorer`, `ploinky`, and any enabled agent repos under `.ploinky/repos`.
- Browser, OS, and headless/headed mode.
- Test account names, excluding passwords.
- Which cases ran, passed, failed, or were skipped.
- Screenshots and traces for failures.
- Relevant Ploinky status and recent service logs with secrets redacted.

Failures that require manual `ploinky var` setup for default/dev profiles are regressions unless the value is a real external credential such as a GitHub account credential. Workspace-owned URLs, ports, LiveKit, TURN, OnlyOffice, DPU, recording, webhook, and generated encryption secrets must be supplied by profile defaults or derived secret entries.
