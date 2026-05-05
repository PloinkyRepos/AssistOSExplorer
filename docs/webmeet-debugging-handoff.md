# WebMeet Debugging Handoff

Last updated: 2026-05-05, after backing off forced TURN relay.

This handoff is for continuing the WebMeet screen-sharing and microphone debugging on `skills.axiologic.dev`.

## Current Production State

- Repository: `PloinkyRepos/AssistOSExplorer`
- Branch: `main`
- Latest deployed code commit: `b3d3840`
- Latest deploy workflow: <https://github.com/PloinkyRepos/AssistOSExplorer/actions/runs/25373151022>
- Deploy conclusion: `success`
- Deployed host: `skills.axiologic.dev`
- SSH command:
  ```sh
  ssh -i ~/demo_private_key.pem admin@193.180.209.191
  ```
- Remote repo path:
  ```sh
  ~/explorerWorkspace/.ploinky/repos/fileExplorer
  ```
- Verified on host after deploy:
  ```text
  repo_head=b3d3840
  ## main...origin/main
  ```
- Public URL check after deploy:
  ```text
  curl -k -sS -o /dev/null -w "%{http_code} %{url_effective}\n" https://skills.axiologic.dev/dashboard
  skills_dashboard=302
  livekit_skills=200
  ```

The runtime container copy was checked after the revert. It is back to the pre-test media-routing baseline:

```text
container=ploinky_fileExplorer_webmeetAgent_explorerWorkspace_c603815d
/code/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js:33: adaptiveStream: true
/code/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js:34: dynacast: true
/code/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js:48: RoomEvent.LocalTrackPublished
```

The user retested after commit `ec81621` and after commit `65ced07`; both still failed. The three temporary WebMeet media-debugging commits were reverted and production was redeployed successfully at `84e780a`.

Latest result: the fresh local deployment works, but the remote deployment on `skills.axiologic.dev` still does not. This makes a production-only infrastructure, proxy, DNS, public LiveKit URL, ICE/TURN, or browser-to-LiveKit connectivity issue more likely than a generic WebMeet client-code issue.

Follow-up production findings:

- `livekit-skills.axiologic.dev` is proxied through Cloudflare.
- LiveKit signaling can work through Cloudflare, but remote browser logs previously showed intermittent `502`/CORS failures on `/rtc/v1/validate`.
- LiveKit advertises direct ICE candidates for `193.180.209.191` on UDP ports `7882-7892`.
- Production logs showed high video packet loss, around `26-29%`, on affected tracks.
- Coturn is running on production with credentials, but the browser was not receiving TURN servers because `webmeetAgent` did not declare/export TURN env vars and `rtc-config.js` returned `undefined`.
- This made remote clients depend on direct UDP media to the LiveKit server, with no TURN relay fallback.

Implemented Part 1 fix:

- `webmeetAgent/manifest.json` now declares `WEBMEET_TURN_*` variables for `default`, `dev`, and `prod`.
- `webmeetAgent/scripts/startAgent.sh` exports TURN variables from the workspace secret store when available.
- `webmeetAgent/lib/webmeetStore.mjs` builds a session `rtcConfig` with STUN plus TURN servers when TURN host/user/password are configured.
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/services/rtc-config.js` now normalizes the session `rtcConfig`.
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js` passes that config to `room.connect(url, token, { rtcConfig })`.
- The fix was committed as `912f22e` and deployed successfully through run `25371857230`.
- A follow-up retest still showed only STUN in `chrome://webrtc-internals`, proving that passing `rtcConfig` through the `new Room(...)` constructor was ignored by this LiveKit SDK.
- Commit `13274d5` moved `rtcConfig` into the `room.connect(...)` options and deployed successfully through run `25372146487`.
- Remote verification inside the `webmeetAgent` container confirmed a join payload now contains:
  ```text
  turn:193.180.209.191:3478?transport=udp
  turn:193.180.209.191:3478?transport=tcp
  username: webmeet
  credential: present
  ```

Retest after `13274d5`:

- `chrome://webrtc-internals` now shows both STUN and TURN URLs in the peer connection config, so the browser receives the TURN config.
- ICE still selected direct LiveKit media candidates, for example browser-to-`193.180.209.191:7892` and browser-to-`193.180.209.191:7884`.
- The publisher showed an outbound screen-share RTP stream plus `remote-inbound-rtp`, meaning LiveKit was receiving at least one screen-share RTP stream from the publisher.
- The receiver still had no `inbound-rtp kind=video` entry, only data channels and transport/candidate stats, so the remote browser still was not receiving a video downtrack.
- A corrected `turnutils_uclient` test from the coturn container to `193.180.209.191:3478` authenticated successfully, allocated relays on the `20000+` range, and reported 0% packet loss. Coturn itself is usable.

Forced relay test result:

- `WEBMEET_ICE_TRANSPORT_POLICY` was added.
- `default`, `dev`, and `prod` profiles now default to `all`.
- Production deploy run `25372702377` completed successfully at commit `7f699c0`.
- Remote verification after deploy confirmed the `webmeetAgent` container has `WEBMEET_ICE_TRANSPORT_POLICY=relay`.
- A throwaway join payload generated inside the container returned `rtcConfig.iceTransportPolicy: "relay"` with STUN plus TURN URLs and a present TURN credential.
- The user then hit a peer-connection establishment failure. LiveKit logs showed relay candidates but the connection closed before it became usable.
- Forced relay is therefore too strict for production right now. Keep TURN available as a fallback, but do not force relay globally.
- Commit `b3d3840` backs production off to `WEBMEET_ICE_TRANSPORT_POLICY=all`, and production deploy run `25373151022` completed successfully.
- Remote verification after deploy confirmed the `webmeetAgent` container has `WEBMEET_ICE_TRANSPORT_POLICY=all`.
- The next focus should be LiveKit subscription/downtrack negotiation for the screen-share publication, plus separate TURN reachability testing if relay support is still needed.

## Important Commit Hygiene

Do not add generated-by metadata, automated-assistant attribution, or `Co-authored-by` footers to commits or documentation unless the user explicitly changes this rule.

## Relevant Containers On The Host

Current production containers observed after the latest deploy:

```text
ploinky_webmeetInfra_webmeetCoturn_explorerWorkspace_c603815d         coturn/coturn:4.6.2
ploinky_webmeetInfra_webmeetRedis_explorerWorkspace_c603815d          redis:7-alpine
ploinky_webmeetInfra_webmeetLivekitServer_explorerWorkspace_c603815d  livekit/livekit-server:latest
ploinky_webmeetInfra_webmeetLivekitEgress_explorerWorkspace_c603815d  livekit/egress:latest
ploinky_fileExplorer_webmeetAgent_explorerWorkspace_c603815d          node:20-alpine
```

Useful commands:

```sh
ssh -i ~/demo_private_key.pem admin@193.180.209.191 'podman ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'
ssh -i ~/demo_private_key.pem admin@193.180.209.191 'podman logs --since 20m ploinky_webmeetInfra_webmeetLivekitServer_explorerWorkspace_c603815d'
ssh -i ~/demo_private_key.pem admin@193.180.209.191 'podman logs --since 20m ploinky_fileExplorer_webmeetAgent_explorerWorkspace_c603815d'
```

## Temporary Code Changes Tried And Reverted

These commits were useful diagnostics but are no longer active on `main`:

- `9278950` was reverted by `84e780a`.
- `ec81621` was reverted by `2e87af9`.
- `65ced07` was reverted by `5980c78`.

### Commit `9278950`: Disable adaptive WebMeet media routing

Status: reverted.

File:

- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js`

Change:

```js
const room = new Room({
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults,
    rtcConfig: this.buildRtcConfigForSession(session)
});
```

Why:

- Publisher WebRTC internals showed outbound screen-share RTP.
- Receivers showed black video or no inbound video.
- Disabling `adaptiveStream` and `dynacast` removed one possible LiveKit layer/subscription optimization failure from the equation.

Deploy:

- GitHub Actions run `25367082324`
- Result: success
- Verified in remote repo and running `webmeetAgent` container.

### Commit `ec81621`: Force WebMeet remote track subscriptions

Status: reverted.

Files:

- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/webmeet-dashboard-modal.js`

Changes:

- Added a `RoomEvent.TrackPublished` event hook in `LivekitRoomController`.
- Added explicit receiver-side subscription handling in `WebMeetDashboardModal`.
- On connect, participant join, and remote track publish, WebMeet now calls `publication.setSubscribed(true)` when available.
- If a publication already has an attached track, WebMeet renders it immediately through the existing `renderPublication(...)` path.

Validation:

```sh
node --check webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js
node --check webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/webmeet-dashboard-modal.js
git diff --cached --check
```

All checks passed before commit.

Deploy:

- GitHub Actions run `25367956870`
- Result: success
- Verified remote repo head and live container file contents.

### Commit `65ced07`: Force WebMeet remote video activation

Status: reverted.

File:

- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/webmeet-dashboard-modal.js`

Change:

- Removed the early return that skipped `publication.setSubscribed(true)` when LiveKit already reported `publication.isSubscribed`.
- For remote video publications, WebMeet now also calls:
  ```js
  publication.setEnabled(true);
  publication.setVideoQuality(livekit.VideoQuality.HIGH);
  publication.setSubscribed(true);
  ```
- This attempts to force the receiver to send both a subscription update and a track-settings update to LiveKit.

Why:

- The 2026-05-05 12:22 Bucharest retest happened after `ec81621`.
- The publisher still had outbound `contentType=screenshare` RTP.
- LiveKit server confirmed the screen-share track was published as `TR_VSqqf6L7s7UuEo`.
- The receiver still had no `inbound-rtp (kind=video)`.
- That means the publisher and LiveKit publication path were working; the remaining gap was LiveKit forwarding/subscriber activation.

Validation:

```sh
node --check webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/webmeet-dashboard-modal.js
git diff --cached --check
```

Deploy:

- GitHub Actions run `25368465869`
- Result: success
- Verified remote repo head and live container file contents.

## Problem Summary

The observed problem is screen sharing not rendering for some receivers.

Confirmed symptoms from user tests:

- Chrome publisher can see its own screen-share preview.
- Other participants may see a black tile instead of the shared screen.
- In a Chrome-to-Chrome local test with two accounts, the publisher had outbound screen-share RTP, but the receiver had no `inbound-rtp (kind=video)` entry.
- Safari receiver previously had a remote `<video>` element with a live track object, but the video had:
  ```json
  {
    "readyState": 0,
    "currentTime": 0,
    "width": 0,
    "height": 0,
    "srcObject": true,
    "tracks": [
      {
        "kind": "video",
        "readyState": "live",
        "muted": false,
        "enabled": true
      }
    ]
  }
  ```
- Users also reported microphone problems where permissions were enabled but other users could not hear them.
- A fresh local deployment from the reverted baseline works.
- The remote deployment from the same reverted baseline still fails.

Important timing:

- User-provided failure logs were provided around `2026-05-05 12:10`, `12:22`, and `12:53 Europe/Bucharest`.
- Commit `ec81621` was created at `2026-05-05 12:15 Europe/Bucharest` and deployed after that.
- A later failed retest happened at approximately `2026-05-05 12:22 Europe/Bucharest`, after `ec81621`.
- Commit `65ced07` was created at `2026-05-05 12:27 Europe/Bucharest` and deployed after that.
- A later failed retest happened at approximately `2026-05-05 12:53 Europe/Bucharest`, after `65ced07`.
- Revert commits `5980c78`, `2e87af9`, and `84e780a` were pushed and redeployed through run `25369780171`.
- After the revert deployment, the user confirmed that local WebMeet works but remote WebMeet still does not.
- Commit `912f22e` then wired TURN into the browser join payload and was deployed through run `25371857230`.
- A retest after `912f22e` still showed only STUN servers in the actual peer connection.
- Commit `13274d5` fixed the client-side handoff by passing `rtcConfig` to `room.connect(...)`; deploy run `25372146487` succeeded.

## Key Browser Evidence Before `65ced07`

Publisher Chrome:

- ICE connected.
- DTLS connected.
- Screen-share transceiver added.
- Outbound screen-share RTP existed:
  ```text
  outbound-rtp kind=video contentType=screenshare active=true codec=VP8
  frameHeight=540
  rid=q
  rid=h
  ```
- LiveKit server saw the screen-share track:
  ```text
  mediaTrack published
  kind video
  source SCREEN_SHARE
  mime video/VP8
  simulcast true
  layers LOW 960x540 rid q, MEDIUM 1920x1080 rid h
  ```

Receiver Chrome:

- ICE connected.
- DTLS connected.
- Data channels open.
- No `inbound-rtp (kind=video)` entry for the screen share.

This made the receiver subscription path the leading suspect. Commits `ec81621` and `65ced07` tested explicit subscription and forced remote video activation. The 12:53 retest still showed no receiver inbound RTP, so those client-side subscription changes were reverted.

## Current Working Hypothesis

The publisher side is capable of capturing and sending screen-share media to LiveKit. LiveKit accepts and publishes the track. Because the same app baseline works locally but fails remotely, the leading hypothesis is now production-specific LiveKit reachability or media routing rather than a general client subscription bug.

Investigate these production-only failure points first:

1. Public WebSocket/TLS routing for `wss://livekit-skills.axiologic.dev`.
2. Reverse-proxy or edge behavior for `/rtc/v1/validate` and WebSocket upgrade requests.
3. LiveKit advertised ICE candidates, especially `node_ip`, `use_external_ip`, and UDP/TCP media ports.
4. Firewall, NAT, or cloud edge restrictions on LiveKit UDP `7882-7892` and TCP fallback `7881`.
5. TURN configuration and whether browser clients actually receive TURN servers in `rtcConfig`.
6. Whether `livekit-skills.axiologic.dev` ever returns intermittent `502` responses during joins or renegotiation.

Earlier client-side possibilities were:

1. The receiver was not subscribing to the remote screen-share publication.
2. The receiver subscribed but LiveKit/client layer routing did not start forwarding frames.
3. The DOM attached a track object, but frames did not decode or render.

Because forced subscription and forced high-quality activation did not resolve the issue, focus next on LiveKit subscriber/downtrack diagnostics, browser-specific decode/render behavior, and whether the client is attaching the correct remote publication after renegotiation.

## What To Test Next

First, force fresh client code:

1. Hard refresh both browser tabs.
2. In DevTools, enable "Disable cache" while DevTools is open.
3. Rejoin the room from both accounts.
4. Start screen share from the publisher.
5. Collect receiver Chrome `chrome://webrtc-internals` after the share starts.

Expected result on the current reverted baseline:

- Receiver `chrome://webrtc-internals` should show an `inbound-rtp (kind=video)` entry for the remote screen share.
- If there is still no inbound RTP, the explicit subscription did not cause LiveKit to forward the track.
- If inbound RTP exists but the tile is black, the failure is likely rendering, decode, CSS/layout, or video element playback.

## Console Snippets For Retest

Run this on the receiver page after the publisher starts screen share:

```js
[...document.querySelectorAll('webmeet-participant-card')].map((card) => {
    const v = card.querySelector('video');
    return {
        participant: card.dataset.participantId,
        label: card.getAttribute('data-display-name'),
        videos: card.querySelectorAll('video').length,
        paused: v?.paused,
        readyState: v?.readyState,
        networkState: v?.networkState,
        currentTime: v?.currentTime,
        width: v?.videoWidth,
        height: v?.videoHeight,
        muted: v?.muted,
        error: v?.error,
        srcObject: Boolean(v?.srcObject),
        tracks: [...(v?.srcObject?.getTracks?.() || [])].map((t) => ({
            id: t.id,
            kind: t.kind,
            label: t.label,
            readyState: t.readyState,
            muted: t.muted,
            enabled: t.enabled
        }))
    };
});
```

If the receiver has a video element but it does not play, try:

```js
document.querySelectorAll('video').forEach((v) => {
    v.muted = true;
    v.playsInline = true;
    v.play().catch(console.error);
});
```

Then re-run the first snippet and check whether `currentTime`, `videoWidth`, and `videoHeight` advance.

## Server Log Commands For Retest

Before reproducing, start logs in separate shells:

```sh
ssh -i ~/demo_private_key.pem admin@193.180.209.191
podman logs -f --since 5m ploinky_webmeetInfra_webmeetLivekitServer_explorerWorkspace_c603815d
podman logs -f --since 5m ploinky_fileExplorer_webmeetAgent_explorerWorkspace_c603815d
```

Useful filtered log command after a reproduction:

```sh
podman logs --since 20m ploinky_webmeetInfra_webmeetLivekitServer_explorerWorkspace_c603815d \
  | grep -Ei 'publish|subscribe|screen|track|error|warn|participant|connection'
```

Look for:

- publisher participant identity
- receiver participant identity
- `SCREEN_SHARE` publish event
- any subscribe event for the receiver
- warnings about downtracks, nack, congestion, codecs, simulcast layers, or permission grants

## LiveKit And Infra Notes

- The LiveKit server is an SFU. It normally forwards encoded media; it does not record or composite normal calls.
- Screen-share encoding happens in the browser.
- LiveKit chooses and forwards layers to subscribers.
- Egress is only involved when recording is active.
- Egress is not expected to cause the current black-screen issue unless recording is running.
- Current production uses one LiveKit server, one Redis, one coturn, and one egress worker.
- LiveKit exposes:
  ```text
  0.0.0.0:7880-7881->7880-7881/tcp
  0.0.0.0:7882-7892->7882-7892/udp
  ```
- Coturn exposes:
  ```text
  0.0.0.0:3478->3478/tcp
  0.0.0.0:3478->3478/udp
  0.0.0.0:20000-20010->20000-20010/udp
  ```
- The current browser join payload still shows only default/STUN ICE servers in `chrome://webrtc-internals`, for example:
  ```json
  {
    "iceServers": [
      {
        "urls": [
          "stun:global.stun.twilio.com:3478",
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302"
        ]
      }
    ]
  }
  ```
- A post-`912f22e` retest still showed only STUN here because the browser passed `rtcConfig` to the wrong LiveKit API layer. After `13274d5`, this section should include both STUN and TURN entries after a hard refresh/rejoin.

## Potential Next Fixes

1. Add temporary client-side debug logging around publication subscription:
   - log `RoomEvent.TrackPublished`
   - log `publication.kind`, `publication.source`, `publication.trackSid`, `publication.isSubscribed`
   - log before and after `publication.setSubscribed(true)`
   - log `RoomEvent.TrackSubscribed`

2. Inspect receiver LiveKit publication state directly after screen share starts:
   - confirm the remote participant has a screen-share publication
   - confirm `publication.isSubscribed === true`
   - confirm `publication.track` becomes non-null

3. If receiver has inbound RTP but black video:
   - inspect `videoWidth`, `videoHeight`, `currentTime`, `readyState`
   - check whether CSS/layout creates a black overlay
   - check whether `track.attach()` returns a new element repeatedly and old elements remain
   - check browser decode errors in console and media internals

4. If receiver has no inbound RTP after explicit subscribe:
   - inspect LiveKit server logs for downtrack/subscription creation
   - check whether LiveKit permissions token has `canSubscribe: true`
   - confirm the receiver is in the same LiveKit room as the publisher
   - check if LiveKit client is unsubscribing immediately due to hidden/paused state

5. For microphone issues:
   - compare publisher `outbound-rtp (kind=audio)` with receiver `inbound-rtp (kind=audio)`
   - check local microphone publication source is `MICROPHONE`
   - check participant tokens include publish/subscribe grants
   - check whether remote audio elements are attached and whether `setSinkId` fails

6. For users on restrictive networks:
   - verify the browser now receives TURN entries in `chrome://webrtc-internals`
   - verify whether the selected candidate pair is direct UDP, TURN UDP, or TURN TCP
   - expand UDP media port ranges if concurrent sessions grow
   - verify firewalls allow LiveKit UDP `7882-7892`, TCP fallback `7881`, and TURN `3478`

## Files To Inspect First

Client connection and LiveKit event wiring:

- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/webmeet-dashboard-modal.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/services/rtc-config.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/webmeet-media-controller.js`

Server tools and tokens:

- `webmeetAgent/tools/webmeet_tool.mjs`
- `webmeetAgent/webmeetStore.mjs`

Infra:

- `webmeetInfra/webmeetLivekitServer/manifest.json`
- `webmeetInfra/webmeetCoturn/manifest.json`
- `webmeetInfra/webmeetLivekitEgress/manifest.json`
- `docs/webmeet-infra-architecture.md`
- `docs/webmeet-livekit-webrtc-explainer.md`

## Local Worktree Warning

At the time this handoff was written, the local checkout still had unrelated modified and untracked files. Do not stage them as part of WebMeet media debugging unless the user asks.

Unrelated modified files observed:

```text
AGENTS.md
docs/webmeet-infra-architecture.md
docs/webmeet-livekit-webrtc-explainer.md
dpuAgent/AGENTS.md
gitAgent/AGENTS.md
```

Untracked paths observed:

```text
.ploinky.accidental-20260505-130050/
CLAUDE.md
docs/webmeet-debugging-handoff.md
webassist/
webmeetInfra/
```

The WebMeet revert commits already pushed to `main` are clean and separate from those local changes.

## Fresh Local Deployment

A fresh local deployment was created at:

```sh
~/work/testExplorerFresh
```

Previous local state was moved aside instead of deleted:

```text
~/work/testExplorerFresh.backup-20260505-130050
```

The local deployment uses:

```text
fileExplorer head: 84e780a
webmeetInfra head: 886a6db
profile: dev
router: http://127.0.0.1:8080
Explorer: http://127.0.0.1:8080/explorer/index.html#file-exp/
LiveKit public URL: ws://127.0.0.1:17880
LiveKit HTTP check: http://127.0.0.1:17880/ -> 200
```

Local WebMeet runtime validation passed inside the `webmeetAgent` container:

```text
webmeet-api: ok
livekit internal TCP webmeetLivekitServer:7880: ok
livekit public TCP host.containers.internal:17880: ok
livekit-egress TCP webmeetLivekitEgress:7980: ok
```

The user manually tested WebMeet on this local deployment and confirmed it works. That is the strongest current discriminator: local `dev` profile works, remote `prod` profile fails.

Useful local commands:

```sh
cd ~/work/testExplorerFresh
/Users/danielsava/work/file-parser/ploinky/bin/ploinky status
podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep testExplorerFresh
podman logs -f ploinky_webmeetInfra_webmeetLivekitServer_testExplorerFresh_d8f88a10
```

## Prompt For Next Debugging Session

Use this prompt to continue the investigation:

```text
You are debugging a production-only WebMeet screen-sharing and microphone issue in /Users/danielsava/work/file-parser/AssistOSExplorer.

Start by reading:
- docs/webmeet-debugging-handoff.md
- docs/webmeet-infra-architecture.md
- docs/webmeet-livekit-webrtc-explainer.md

Current state:
- production code is at b3d3840.
- Production deploy run 25373151022 succeeded.
- Remote repo on skills.axiologic.dev is at b3d3840.
- Part 1 TURN wiring has been implemented, pushed, and deployed. Commit 13274d5 is the important correction because it passes `rtcConfig` to `room.connect(...)`.
- Browser retest after 13274d5 showed TURN URLs are now present in the browser config, but ICE still selected direct LiveKit UDP candidates and the receiver still had no inbound video RTP.
- Commit 7f699c0 added `WEBMEET_ICE_TRANSPORT_POLICY` and forced production relay as a test. That caused peer-connection establishment failures, so the current code backs production off to `all` while keeping TURN configured.
- Three temporary client-side debugging commits were tried and reverted:
  - 9278950 reverted by 84e780a
  - ec81621 reverted by 2e87af9
  - 65ced07 reverted by 5980c78
- Fresh local deployment in ~/work/testExplorerFresh works.
- Remote deployment on https://skills.axiologic.dev still fails.
- Public LiveKit host is https://livekit-skills.axiologic.dev and the browser joins via wss://livekit-skills.axiologic.dev.
- Previous remote browser console showed intermittent 502/CORS failures on /rtc/v1/validate during LiveKit connection attempts.
- Production findings indicate the browser was not receiving TURN servers even though Coturn is running.
- Latest production findings indicate the browser now receives TURN servers, but forced relay caused peer-connection establishment failures. Production should use `all` while the screen-share downtrack issue is debugged.

Goal:
Find and fix the production-only cause. Prioritize remote LiveKit reachability, proxy/WebSocket/TLS behavior, ICE candidate advertisement, UDP/TCP media ports, TURN config, and differences between local dev profile and remote prod profile.

Constraints:
- Do not add generated-by metadata, automated-assistant attribution, or Co-authored-by footers to commits or documentation.
- Do not stage unrelated local changes. The worktree has unrelated AGENTS/CLAUDE/docs/webassist/webmeetInfra changes.
- Keep fixes narrowly scoped and verify with a remote redeploy plus browser WebRTC evidence.

Suggested first checks:
1. SSH to production:
   ssh -i ~/demo_private_key.pem admin@193.180.209.191
2. Verify production env and container state:
   cd ~/explorerWorkspace
   podman ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
   cd ~/explorerWorkspace/.ploinky/repos/fileExplorer && git rev-parse --short HEAD && git status --short --branch
3. Inspect WebMeet and LiveKit runtime env:
   podman exec ploinky_fileExplorer_webmeetAgent_explorerWorkspace_c603815d sh -lc 'printenv | sort | grep WEBMEET'
   podman exec ploinky_webmeetInfra_webmeetLivekitServer_explorerWorkspace_c603815d sh -lc 'cat /code/livekit.yaml'
4. Capture LiveKit logs during a failing remote test:
   podman logs -f --since 5m ploinky_webmeetInfra_webmeetLivekitServer_explorerWorkspace_c603815d
   podman logs -f --since 5m ploinky_fileExplorer_webmeetAgent_explorerWorkspace_c603815d
5. Compare local and production LiveKit config, especially:
   WEBMEET_PUBLIC_LIVEKIT_URL
   WEBMEET_LIVEKIT_URL
   WEBMEET_LIVEKIT_USE_EXTERNAL_IP
   WEBMEET_LIVEKIT_NODE_IP
   WEBMEET_TURN_EXTERNAL_IP
   WEBMEET_ICE_TRANSPORT_POLICY
   exposed LiveKit ports 7880, 7881, 7882-7892/udp
6. From the browser receiver, verify whether chrome://webrtc-internals has inbound-rtp video. If not, focus on LiveKit not forwarding media or the browser not receiving usable ICE candidates.
7. Check the reverse proxy / DNS / edge config for livekit-skills.axiologic.dev. Confirm WebSocket upgrade and /rtc/v1/validate are forwarded to LiveKit without intermittent 502 or missing CORS headers.

Expected output:
- Root cause hypothesis backed by logs/config/browser evidence.
- Minimal code or deployment/config change.
- Redeploy command and verification steps.
```

## Redeploy Command

Use this after a future commit is pushed to `main`:

```sh
gh workflow run deploy-skills-explorer.yml \
  --repo PloinkyRepos/AssistOSExplorer \
  --ref main \
  -f branch=main \
  -f workspace_name=explorerWorkspace \
  -f router_port=8097 \
  -f public_url=https://skills.axiologic.dev \
  -f profile=prod
```

Then watch the run:

```sh
gh run watch <run-id> --repo PloinkyRepos/AssistOSExplorer --exit-status
```

Verify on the host:

```sh
ssh -i ~/demo_private_key.pem admin@193.180.209.191 \
  'cd ~/explorerWorkspace/.ploinky/repos/fileExplorer && git rev-parse --short HEAD && git status --short --branch'

ssh -i ~/demo_private_key.pem admin@193.180.209.191 \
  'cid=$(podman ps --format "{{.Names}}" | grep "fileExplorer_webmeetAgent" | head -n1); podman exec "$cid" sh -lc "grep -n \"TrackPublished\\|setSubscribed\\|adaptiveStream\\|dynacast\" /code/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js /code/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/webmeet-dashboard-modal.js"'
```
