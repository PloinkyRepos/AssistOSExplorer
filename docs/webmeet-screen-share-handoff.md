# WebMeet Screen Share Handoff

Date: 2026-05-07

This handoff summarizes the WebMeet deployment, secret-derivation, LiveKit, and remote screen-share work completed across the `AssistOSExplorer` repository and the nested `webmeetInfra` repository. It is intended for another code agent to continue from the current state without rediscovering the same failure modes.

## Current Production State

Production URL:

- Explorer: `https://skills.axiologic.dev`
- LiveKit public signaling hostname: `https://livekit-skills.axiologic.dev`

`skills.axiologic.dev` can remain behind Cloudflare Tunnel. `livekit-skills.axiologic.dev` should resolve directly to the LiveKit/Nginx host for the direct-UDP topology. Cloudflare Tunnel public hostnames proxy HTTP/HTTPS/WebSocket traffic, but they do not provide a general public UDP media proxy for WebRTC.

Remote host:

- SSH target for read-only/debug status: `admin@193.180.209.191`
- Key path used locally: `~/demo_private_key.pem`
- Workspace: `~/explorerWorkspace`
- Router port: `8097`

Production was deployed through GitHub Actions, not by direct mutation over SSH.

Current deployed commits after the UDP migration deploy:

- `AssistOSExplorer`: `8ec9d2c` (`Fix WebMeet video track attachment`)
- `webmeetInfra`: `f123a45` (`Allow forcing LiveKit TCP media`)

Generated LiveKit config on production was verified as:

```yaml
logging:
  level: info
rtc:
  tcp_port: 7881
  port_range_start: 7882
  port_range_end: 7892
  use_external_ip: false
  force_tcp: false
  node_ip: 193.180.209.191
```

Repository variables set for production:

- `WEBMEET_LIVEKIT_FORCE_TCP=false`
- `WEBMEET_LIVEKIT_LOG_LEVEL=info`

Required GitHub secrets remain secret-only and must not be printed:

- `SSH_KEY`
- `PLOINKY_MASTER_KEY`
- `SOUL_GATEWAY_API_KEY` if the deployment needs Soul Gateway integration

## High-Level Outcome

The remote black-screen screen-share issue is fixed.

Final Playwright browser smoke against `https://skills.axiologic.dev`:

- Artifact directory: `/tmp/webmeet-screen-diag-1778163087790`
- Test room: `diag-1778163087790`
- Admin account published a screen share.
- Daniel account received, decoded, and displayed the screen share.
- Daniel receiver video state:
  - `readyState: 4`
  - `videoWidth: 1280`
  - `videoHeight: 720`
  - `framesDecoded: 147`
  - `framesReceived: 147`
  - `keyFramesDecoded: 1`
  - `packetsLost: 0`
- Admin publisher stats:
  - `framesEncoded: 149`
  - `keyFramesEncoded: 2`
  - `bytesSent: 978040`
- Selected receiver media candidate:
  - `candidateType: host`
  - `protocol: udp`
  - `address: 193.180.209.191`
  - `port: 7892`

LiveKit media now works over direct UDP to the host while signaling continues through the configured public LiveKit URL. The temporary TCP workaround was removed after verifying UDP candidate selection and decoded receiver frames.

## Issues Found

### 1. Fresh deployment failed on missing LiveKit API key

Initial `ploinky start explorer` from a clean deployment failed during `webmeetLivekitServer` preinstall:

```text
WEBMEET_LIVEKIT_API_KEY is required
```

Root cause:

- Some WebMeet/LiveKit/TURN credentials were still modeled as manually configured secrets.
- This violated the runtime invariant: every Ploinky-owned agent secret must be derived from the derived workspace master key rather than manually configured.

Fixes:

- Renamed the previous wire/root runtime secret concept from `PLOINKY_WIRE_SECRET` to `PLOINKY_DERIVED_MASTER_KEY`.
- Updated specs and manifests so agent-owned generated secrets derive from `PLOINKY_DERIVED_MASTER_KEY`.
- Shared logical derivation identities across `webmeetAgent`, `webmeetLivekitServer`, `webmeetLivekitEgress`, and `webmeetCoturn` so all components agree on the same LiveKit/TURN credentials.
- Removed deploy-workflow injection of derived agent secrets. Deployment now passes `PLOINKY_MASTER_KEY` to Ploinky lifecycle commands and lets Ploinky/runtime derivation produce agent secrets.

Relevant `AssistOSExplorer` commits:

- `e01d978` `Enforce derived master agent secrets`
- `3798af7` `Share WebMeet derived media secrets`
- `beb48d0` `Stop deploying derived agent secrets`

Relevant `webmeetInfra` commits:

- `0c71f13` `Require production WebMeet media secrets`
- `24c32c5` `Remove LiveKit hook credential fallbacks`
- `254d129` `Remove default WebMeet credential fallbacks`
- `663fed2` `Share WebMeet derived media secrets`

### 2. Local WebMeet room join hit LiveKit "invalid API key"

Observed browser failure:

```text
WebSocket connection failed: 401 Unauthorized
```

Root cause:

- The LiveKit server and `webmeetAgent` were not guaranteed to use the same derived LiveKit API key/secret.
- The browser obtained a participant JWT signed by one side, but LiveKit validated it against a different key/secret.

Fix:

- Use shared derivation labels for LiveKit API credentials across all relevant manifests.
- The server-side LiveKit config and `webmeetAgent` token signing now derive the same values from `PLOINKY_DERIVED_MASTER_KEY`.

Validation:

- Local deployment no longer produced LiveKit 401 after derivation labels were aligned.
- Production fresh deploy no longer required manual LiveKit API key/secret variables.

### 3. Remote screen-share receiver saw black video

Symptoms on production:

- Both accounts could log in and join a room.
- Admin could start screen share.
- Daniel saw a signaled/subscribed track, but the video stayed black.
- Daniel receiver initially had `videoWidth: 0`, `videoHeight: 0`, `readyState: 0`, or almost no inbound RTP.
- Local deployment worked, so the problem was topology/environment-specific.

Evidence gathered:

- Browser-side diagnostics showed the receiver had a track element but did not decode useful frames.
- LiveKit debug logs showed repeated PLI/keyframe requests and keyframe seeder timeout.
- UDP ports were mapped on the container, but the deployment was behind Cloudflare Tunnel.
- Browser ICE candidate stats before the TCP fix selected UDP/direct media candidates.

Root cause:

- Signaling worked through Cloudflare Tunnel because it is HTTPS/WebSocket traffic.
- WebRTC media is a separate ICE/SRTP media plane.
- LiveKit default behavior preferred UDP media ports.
- Cloudflare Tunnel public hostnames do not proxy arbitrary UDP media from browsers to the origin.
- Result: room signaling succeeded, but the media path could not reliably deliver the screen-share keyframes needed by subscribers.

Important Cloudflare documentation:

- Cloudflare Tunnel public hostname protocols list HTTP/HTTPS/WebSocket-style routing and TCP-over-WebSocket with client-side `cloudflared`, not generic UDP public routing:
  - `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/`
  - `https://developers.cloudflare.com/tunnel/routing/`
- Cloudflare Spectrum is the UDP-capable product, but Spectrum with Cloudflare Tunnel is only supported for HTTP/HTTPS origins, not generic TCP/UDP Tunnel origins:
  - `https://developers.cloudflare.com/spectrum/reference/limitations/`

Fix:

- Added configurable LiveKit `rtc.force_tcp`.
- Set production `WEBMEET_LIVEKIT_FORCE_TCP=true`.
- Deployed through `.github/workflows/deploy-skills-explorer.yml`.

Relevant commits:

- `webmeetInfra` `f123a45` `Allow forcing LiveKit TCP media`
- `AssistOSExplorer` `8e1a4fd` `Pass LiveKit TCP media setting during deploy`

### 4. Screen-share publish behavior had regressed since the known-good commit

Known-good reference:

- `807dc71b802b1bfbd4ab47c327a3981ba858db3e`

Suspicious commits reviewed:

- `9ad39c7` `Use LiveKit defaults for WebMeet screen share`
  - Removed explicit non-simulcast screen-share publishing options.
- `5a86645` / `1ed7f25`
  - Removed or changed stuck-video refresh behavior.

Fix:

- Restored explicit non-simulcast screen-share publishing.
- Added browser diagnostics around connect/publish/subscribe/video readiness.
- Added a guard to avoid attaching the same subscribed track repeatedly and replacing the existing video element.

Relevant commits:

- `51d61ce` `Stabilize WebMeet screen sharing`
- `1279d55` `Avoid duplicate WebMeet video attachments`

Note:

- The primary production root cause was still the Cloudflare Tunnel/UDP media path.
- The non-simulcast and duplicate-attachment changes are still valuable because they reduce screen-share and video-element churn and make future diagnosis easier.

## Code Changes By Area

### `AssistOSExplorer`

#### Secret derivation and invariant

Commit: `e01d978` `Enforce derived master agent secrets`

Key files changed:

- `docs/specs/DS06-ploinky-runtime-invariants.md`
- `docs/analysis-explorer-agents.md`
- `dpuAgent/manifest.json`
- `dpuAgent/server/standalone-mcp-server.mjs`
- `explorer/manifest.json`
- `explorer/plugins/onlyoffice/server/onlyoffice/onlyoffice-dpu-client.mjs`
- `explorer/plugins/onlyoffice/utils/server/onlyoffice/workspace-secrets.mjs`
- `gitAgent/manifest.json`
- `gitAgent/lib/secret-store-client.mjs`
- multiple local agent runtime invariant specs
- `webmeetAgent/manifest.json`
- `webmeetAgent/lib/webmeetStore.mjs`
- `webmeetAgent/server/webmeet-public-proxy.mjs`

Current invariant text:

```text
PLOINKY_DERIVED_MASTER_KEY is the mandatory root for Ploinky-owned and agent-owned generated secrets.
```

Agent-owned generated secrets should be derived through manifest `derive: "derived-master"`, `{{derivedMasterSecret:...}}`, or a documented runtime helper. External third-party credentials remain explicit operator configuration.

#### Shared WebMeet media secrets

Commit: `3798af7` `Share WebMeet derived media secrets`

Key files changed:

- `webmeetAgent/manifest.json`

Purpose:

- Ensure `webmeetAgent` derives LiveKit/TURN/WebMeet data keys with logical derivation labels that match `webmeetInfra`.
- Prevent server/token credential mismatch.

Current spec home:

- `webmeetAgent/docs/specs/DS10-livekit-media-runtime.md` now carries the WebMeet LiveKit, WebRTC, public topology, and derived-media-secret contracts that were formerly split across root-level WebMeet docs.

#### Deployment workflow no longer injects derived secrets

Commit: `beb48d0` `Stop deploying derived agent secrets`

Key file:

- `.github/workflows/deploy-skills-explorer.yml`

Purpose:

- Remove deploy-time writes of derived agent secrets.
- Keep `PLOINKY_MASTER_KEY` as the only master material passed to lifecycle commands.
- Let Ploinky/runtime derive the lower-level agent secrets.

#### Browser-side media diagnostics and screen-share stabilization

Commit: `51d61ce` `Stabilize WebMeet screen sharing`

Key files:

- `webmeetAgent/web/public/assets/controllers/livekit-room-controller.js`
- `webmeetAgent/web/public/assets/controllers/media-settings-methods.js`
- `webmeetAgent/web/public/assets/controllers/room-session-methods.js`
- `webmeetAgent/web/public/assets/controllers/webmeet-media-controller.js`
- `webmeetAgent/web/public/assets/services/media-diagnostics.js`
- `webmeetAgent/docs/specs/DS08-room-types.md`

Behavior:

- Screen-share publish uses explicit non-simulcast settings.
- Media diagnostics are gated behind `WEBMEET_MEDIA_DEBUG` or `webmeetMediaDebug=1`.
- Diagnostics log connect, publish, subscribe, attachment, and video-readiness events.

#### Duplicate track attach guard

Commit: `1279d55` `Avoid duplicate WebMeet video attachments`

Key file:

- `webmeetAgent/web/public/assets/controllers/room-session-methods.js`

Behavior:

- If a subscribed track with the same `trackSid` already has an element, skip duplicate attachment.
- Prevents repeated replacement of an otherwise valid video element.

#### LiveKit diagnostic log level deploy variable

Commit: `a1e1650` `Pass LiveKit log level during deploy`

Key file:

- `.github/workflows/deploy-skills-explorer.yml`

Behavior:

- Passes `WEBMEET_LIVEKIT_LOG_LEVEL` from GitHub Actions vars to Ploinky vars.
- Used temporarily with `debug` during diagnosis.
- Reset to `info` after the fix.

#### LiveKit TCP media deploy variable

Commit: `8e1a4fd` `Pass LiveKit TCP media setting during deploy`

Key file:

- `.github/workflows/deploy-skills-explorer.yml`

Behavior:

- Passes `WEBMEET_LIVEKIT_FORCE_TCP` from GitHub Actions vars to Ploinky vars.
- Production currently sets this to `true`.

### `webmeetInfra`

#### Production media secrets and no fallback credentials

Commits:

- `0c71f13` `Require production WebMeet media secrets`
- `24c32c5` `Remove LiveKit hook credential fallbacks`
- `254d129` `Remove default WebMeet credential fallbacks`
- `663fed2` `Share WebMeet derived media secrets`

Key files:

- `docs/specs/DS003-livekit-server-agent.md`
- `docs/specs/DS004-livekit-egress-agent.md`
- `docs/specs/DS005-coturn-agent.md`
- `docs/specs/DS007-ploinky-runtime-invariants.md`
- `webmeetCoturn/manifest.json`
- `webmeetLivekitEgress/manifest.json`
- `webmeetLivekitEgress/scripts/hooks/preinstall.sh`
- `webmeetLivekitServer/manifest.json`
- `webmeetLivekitServer/scripts/hooks/preinstall.sh`

Behavior:

- Production requires media credentials to be present through runtime configuration.
- Default development credentials and hook fallback credentials were removed.
- LiveKit/TURN credentials are derived from the shared derived master secret contract.

#### LiveKit diagnostic log level

Commit: `5ef5538` `Add LiveKit diagnostic log level`

Key files:

- `docs/specs/DS003-livekit-server-agent.md`
- `webmeetLivekitServer/manifest.json`
- `webmeetLivekitServer/scripts/hooks/preinstall.sh`

Behavior:

- Adds `WEBMEET_LIVEKIT_LOG_LEVEL`.
- The preinstall hook writes:

```yaml
logging:
  level: ${log_level}
```

Current production value is `info`.

#### LiveKit forced TCP media

Commit: `f123a45` `Allow forcing LiveKit TCP media`

Key files:

- `docs/specs/DS003-livekit-server-agent.md`
- `webmeetLivekitServer/manifest.json`
- `webmeetLivekitServer/scripts/hooks/preinstall.sh`

Behavior:

- Adds `WEBMEET_LIVEKIT_FORCE_TCP`.
- The preinstall hook writes:

```yaml
rtc:
  force_tcp: ${force_tcp}
```

Current production value is `false`.

## Deployment Actions Run

Production deploys used GitHub Actions workflow:

```text
.github/workflows/deploy-skills-explorer.yml
```

Relevant successful runs:

- `25499187100`
  - Deployed `AssistOSExplorer` `8e1a4fd`
  - Deployed `webmeetInfra` `f123a45`
  - Confirmed `force_tcp: true`
  - LiveKit logging was still `debug` during diagnosis
- `25499414569`
  - Cleanup deploy
  - Kept `force_tcp: true`
  - Reset LiveKit logging to `info`
- `25500712127`
  - UDP canary deploy
  - Set `force_tcp: false`
  - Verified LiveKit config generated direct UDP candidates
- `25501046519`
  - Deployed `8ec9d2c` video attachment fix
  - Kept `force_tcp: false`
  - Final browser smoke decoded and displayed screen share over UDP

Earlier deploy runs during diagnosis:

- `25498225464`
  - Deployed screen-share stabilization
  - Screen share still failed remotely
- `25498696389`
  - Deployed duplicate attachment guard
  - Screen share still failed remotely
- `25498945519`
  - Deployed LiveKit debug logging
  - Captured keyframe timeout evidence

## Browser Test Harness

Temporary harness path:

```text
/tmp/webmeet-playwright/diag.mjs
```

The harness:

- Opens two headless browser contexts.
- Logs in as `daniel` and `admin`.
- Uses password from `WEBMEET_TEST_PASSWORD`.
- Creates/joins a diagnostic room.
- Starts screen share from admin using fake media/display capture.
- Captures browser console/network/media diagnostics.
- Writes JSON and screenshot artifacts under `/tmp/webmeet-screen-diag-*`.
- Redacts keys containing credential/password/token/secret/authorization before writing artifacts.

Run command:

```bash
WEBMEET_TEST_PASSWORD=admin \
WEBMEET_BASE_URL=https://skills.axiologic.dev \
node /tmp/webmeet-playwright/diag.mjs
```

Useful artifact checks:

```bash
jq '{
  joinStatus,
  roomState,
  localMediaState,
  participantCount,
  videos,
  inboundVideo: [
    .peerConnections[].stats[]?
    | select(.type=="inbound-rtp" and .kind=="video")
    | {
        id,
        bytesReceived,
        framesDecoded,
        framesReceived,
        keyFramesDecoded,
        packetsLost,
        packetsReceived,
        pliCount,
        nackCount
      }
  ],
  remoteCandidates: [
    .peerConnections[].stats[]?
    | select(.type=="remote-candidate")
    | {
        id,
        candidateType,
        protocol,
        address,
        port
      }
  ]
}' /tmp/webmeet-screen-diag-*/daniel-after-screen.json
```

Admin outbound check:

```bash
jq '{
  joinStatus,
  roomState,
  localMediaState,
  participantCount,
  videos,
  outboundVideo: [
    .peerConnections[].stats[]?
    | select(.type=="outbound-rtp" and .kind=="video")
    | {
        id,
        bytesSent,
        framesEncoded,
        keyFramesEncoded,
        pliCount,
        nackCount
      }
  ],
  remoteCandidates: [
    .peerConnections[].stats[]?
    | select(.type=="remote-candidate")
    | {
        id,
        candidateType,
        protocol,
        address,
        port
      }
  ]
}' /tmp/webmeet-screen-diag-*/admin-after-screen.json
```

Expected passing result:

- Receiver `videos[0].readyState` is `4`.
- Receiver `videos[0].videoWidth` and `videoHeight` are non-zero.
- Receiver inbound RTP has increasing `framesDecoded`.
- Receiver remote candidate protocol is `udp` on `193.180.209.191:7882-7892` for the current direct-UDP production topology.

## Remote Verification Commands

Verify deployed commits and generated LiveKit config without leaking keys:

```bash
ssh -i ~/demo_private_key.pem -o StrictHostKeyChecking=no admin@193.180.209.191 '
  cd ~/explorerWorkspace &&
  printf "AchillesIDE " &&
  git -C .ploinky/repos/AchillesIDE rev-parse --short HEAD &&
  printf "webmeetInfra " &&
  git -C .ploinky/repos/webmeetInfra rev-parse --short HEAD &&
  awk "BEGIN{skip=0}
       /^keys:/{print \"keys:\"; print \"  <redacted>: <redacted>\"; skip=1; next}
       skip && /^  /{next}
       {skip=0; print}" \
      .ploinky/agents/webmeetLivekitServer/livekit.yaml |
  sed -n "1,24p"
'
```

Check recent LiveKit logs while avoiding secret output:

```bash
ssh -i ~/demo_private_key.pem -o StrictHostKeyChecking=no admin@193.180.209.191 '
  podman logs --since 8m ploinky_webmeetInfra_webmeetLivekitServer_explorerWorkspace_c603815d 2>&1 |
  grep -E "mediaTrack published|send pli|key frame|SCREEN_SHARE|TR_" |
  tail -180
'
```

Only use the LiveKit log command for diagnosis. Avoid printing SDP, ICE credentials, JWTs, API keys, or raw request payloads.

## Why TCP Fixed The Cloudflare Tunnel Deployment

LiveKit has two planes:

- Signaling: HTTPS/WebSocket. This works through Cloudflare Tunnel.
- Media: WebRTC ICE/SRTP. By default this prefers UDP. Cloudflare Tunnel public hostnames do not proxy arbitrary browser UDP media to the origin.

Before the fix, the room could join and tracks could be signaled, but subscribers could not receive usable screen-share keyframes over the UDP media path. LiveKit debug logs showed repeated keyframe requests and timeout.

The temporary `rtc.force_tcp: true` workaround proved that the issue was transport-related. After routing LiveKit signaling through the host Nginx path and setting `WEBMEET_LIVEKIT_FORCE_TCP=false`, browsers selected direct UDP host candidates on `193.180.209.191:7882-7892`, and the receiver decoded and displayed frames.

Tradeoffs:

- TCP is more reliable through this topology.
- TCP can add latency under packet loss due to retransmission and head-of-line blocking.
- Screen share tolerates this better than low-latency camera/audio.
- For higher scale or lower latency, the cleaner architecture is direct LiveKit UDP/TCP media exposure outside Cloudflare Tunnel, or a TURN/TLS relay on port `443`.

## Remaining Risks And Follow-Ups

Known fixed:

- Fresh deployment no longer requires manually configured LiveKit API key/secret.
- Local LiveKit invalid API key mismatch was fixed by shared derived media secrets.
- Remote screen-share black receiver was first worked around by forcing TCP media, then moved back to direct UDP after Nginx/direct-host signaling and the UI attachment regression were verified.
- LiveKit production log level is back to `info`.

Risks:

- UDP media depends on direct reachability to `193.180.209.191:7882-7892/udp`.
- Signaling can be proxied by Nginx, but normal HTTP reverse proxying does not carry WebRTC UDP media.
- The browser diagnostic harness is temporary under `/tmp`. If this test should be reusable, move it into a committed test location and scrub any environment-specific assumptions.
- If production topology changes back to a pure tunnel/proxy setup without direct UDP reachability, reassess whether `WEBMEET_LIVEKIT_FORCE_TCP=true` is needed again.

Recommended next tasks:

1. Add a committed WebMeet screen-share Playwright smoke test that redacts sensitive data by design.
2. Keep the production Cloudflare Tunnel limitation documented in `webmeetAgent/docs/specs/DS10-livekit-media-runtime.md`.
3. Decide whether direct UDP media exposure is acceptable long term, or whether to use TURN/TLS on `443`.
4. If scaling WebMeet usage, load test LiveKit with direct UDP and a wider media port range before relying on it for larger meetings.
5. Keep the derived-secret invariant strict. Do not reintroduce manual LiveKit/TURN fallback credentials.

## Recovery Checklist

If screen share regresses:

1. Confirm production is on the expected commits.
2. Confirm generated LiveKit config has `force_tcp: false` for the Nginx/direct-UDP topology.
3. Confirm GitHub repo variable `WEBMEET_LIVEKIT_FORCE_TCP` is `false`.
4. Confirm Cloudflare DNS sends `livekit-skills.axiologic.dev` directly to the LiveKit/Nginx host, not to a Tunnel public hostname.
5. Run the two-browser harness and inspect Daniel receiver `framesDecoded`.
6. Inspect candidate stats. Passing production should select `udp` to `193.180.209.191:7882-7892`.
7. Temporarily set `WEBMEET_LIVEKIT_LOG_LEVEL=debug`, redeploy, capture LiveKit logs, then reset it to `info` and redeploy again.
8. Do not print secrets, JWTs, SDP blobs, ICE credentials, or raw request payloads in logs or handoff notes.

Useful deploy command:

```bash
gh workflow run deploy-skills-explorer.yml \
  --repo PloinkyRepos/AssistOSExplorer \
  --ref main \
  -f branch=main
```

Watch the latest deploy:

```bash
gh run list \
  --repo PloinkyRepos/AssistOSExplorer \
  --workflow deploy-skills-explorer.yml \
  --limit 1 \
  --json databaseId,status,conclusion,headSha,createdAt
```

Then:

```bash
gh run watch <run-id> \
  --repo PloinkyRepos/AssistOSExplorer \
  --exit-status
```
