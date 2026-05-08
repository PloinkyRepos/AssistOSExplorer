# WebMeet Screen Share Handoff

Date: 2026-05-08

This handoff summarizes the WebMeet deployment, secret-derivation, LiveKit, and remote screen-share work completed across the `AssistOSExplorer` repository, the nested `webmeetInfra` repository, and the `OutfinityResearch/ploinky` runtime. It is intended for another code agent to continue from the current state without rediscovering the same failure modes.

## Latest Investigation: Why UDP Failed And The Host-Network Fix

A second investigation pass on 2026-05-08 narrowed the UDP failure beyond "unreliable transport" to a specific podman bridge interaction. The summary below replaces the previous "topology-related, suspect host firewall/MTU" framing.

### Evidence

Comparison of the failed UDP canary `/tmp/webmeet-screen-diag-1778229427940` against the passing TCP run `/tmp/webmeet-screen-diag-1778230127397`:

- TCP-pass receivers (daniel, mircea): `inbound-rtp video framesDecoded = 147`, `bytesReceived ≈ 953 KB`, nominated remote candidate `tcp 193.180.209.191:7881`. Healthy media.
- UDP-fail receivers: nominated UDP host candidate selected, ICE state `succeeded`, RTT ≈ 0.054 s, but `bytesReceived ≈ 1.39 KB / packetsReceived = 11` and `inbound-rtp` array empty. Browser-side dashboard subscribed and attached the track; LiveKit sent no usable subscriber SRTP.
- UDP-fail publisher (admin): `outbound-rtp video bytesSent = 293 KB`, `framesEncoded = 81`, `keyFramesEncoded = 15`, `pliCount = 14`. Uplink and PLI feedback worked. Subscriber downlink did not.
- Smoking gun: every UDP-fail PeerConnection (admin, daniel, mircea) reports a `prflx udp 10.89.0.100:<port>` peer-reflexive local candidate. `10.89.0.0/24` is the podman `webmeet` bridge subnet and `10.89.0.108` is the LiveKit container IP. LiveKit's STUN binding response advertised the browser's source as `10.89.0.100`, i.e., the bridge-internal address used by podman's UDP port-forwarding path.

### Root Cause (Inferred From The Evidence Above)

The LiveKit container ran on the podman `webmeet` bridge with `0.0.0.0:7882-7892:7882-7892/udp` published. Inbound UDP from a browser was DNAT'd to the container at the kernel layer, but the source IP visible inside the container was rewritten to a bridge-local address (`10.89.0.100`). LiveKit's ICE library learned the remote peer at that bridge IP. When LiveKit then originated SRTP forwards toward each subscriber, the kernel routed those packets from `10.89.0.108` to `10.89.0.100` inside the bridge subnet — they never traversed the host's external interface and never reached the real browser.

ICE/STUN keepalives (small, infrequent) survived because the kernel reverses conntrack on responses, so the browser kept seeing the candidate-pair as `succeeded`. The publisher path also survived because uplink media is browser-initiated and the kernel handles RTCP back via the same reverse-conntrack path. Only the subscriber downlink — fresh SFU-initiated outbound UDP — was sent to the wrong destination and silently dropped.

TCP works because libwebrtc reuses the established TCP socket for both directions; the destination-address artifact does not affect TCP byte flow.

### Fix Applied

Move LiveKit out of podman's bridge networking so it binds directly on the host network namespace and sees real client addresses. Three coordinated changes:

1. `OutfinityResearch/ploinky` `fc4bed3` `Support host network mode in agent manifests`:
   - Recognizes `manifest.network.mode: "host"`. Emits `--network host`, skips named-network creation, network aliases, and `-p` port publishing for that container. Other branches unchanged.
   - File: `cli/services/docker/agentServiceManager.js`.
2. `webmeetInfra` `8b0dc9f` `Run LiveKit on host network`:
   - `webmeetLivekitServer/manifest.json`: replace `network.name: "webmeet"` with `network.mode: "host"`. Drop the per-profile `ports` lists. LiveKit now binds 7880, 7881, 7882-7892/udp directly on the host.
   - `webmeetLivekitServer/scripts/hooks/preinstall.sh`: write the LiveKit Redis address from `WEBMEET_LIVEKIT_REDIS_ADDRESS` (default `127.0.0.1:6379`) since LiveKit is host-net and reaches Redis through the published `6379` port.
   - `webmeetLivekitEgress/scripts/hooks/preinstall.sh`: write `ws_url` from `WEBMEET_LIVEKIT_INTERNAL_WS_URL` (default `ws://host.containers.internal:7880`). Egress is still on the `webmeet` bridge and reaches host-net LiveKit through the host gateway. Redis address is overridable via `WEBMEET_EGRESS_REDIS_ADDRESS` (default unchanged).
3. `AssistOSExplorer`: GitHub repo var `WEBMEET_LIVEKIT_URL` updated from `http://webmeetLivekitServer:7880` to `http://host.containers.internal:7880` so `webmeetAgent` (on the bridge) reaches LiveKit's HTTP API through the host gateway.

The Coturn agent and Redis agent stay on the bridge. Coturn is unused in the canary path. Redis publishes 6379 on the host, which is now what host-net LiveKit consumes.

### Production Ploinky Update

Production ploinky lives in `~/ploinky/` on the deploy host as a git checkout of `outfinityresearch/ploinky` `master`. The deploy workflow runs `ploinky update` which calls `updatePloinkySelf` → `pullGitRepo` (`git pull --rebase --autostash`). Pushing the host-network patch to `master` is sufficient — the next deploy run picks it up automatically.

### Canary And Verification Steps For The Next UDP Run

1. Confirm `OutfinityResearch/ploinky` master is at the host-network commit and `webmeetInfra` main is at the LiveKit-host commit.
2. Set GitHub repo var `WEBMEET_LIVEKIT_FORCE_TCP=false` (UDP canary).
3. Trigger `.github/workflows/deploy-skills-explorer.yml`.
4. Verify on the host: `podman inspect <livekit container> --format '{{.HostConfig.NetworkMode}}'` returns `host`, and `ss -lnup | grep -E '7882|7892'` shows LiveKit listening on the host's network namespace.
5. Run the 3-user harness; expect daniel and mircea `framesDecoded > 0`, selected remote candidate `udp 193.180.209.191:<7882-7892>`, no `prflx 10.89.0.x` candidate.
6. If the canary fails, revert `WEBMEET_LIVEKIT_FORCE_TCP=true` immediately and capture artifacts.

## Current Production State

Production URL:

- Explorer: `https://skills.axiologic.dev`
- LiveKit public signaling URL: `wss://livekit-skills.axiologic.dev`

`skills.axiologic.dev` can remain behind Cloudflare Tunnel. `livekit-skills.axiologic.dev` currently resolves directly to the LiveKit/Nginx host for browser-facing LiveKit signaling and LiveKit TCP media fallback. Cloudflare Tunnel public hostnames proxy HTTP/HTTPS/WebSocket traffic, but they do not provide a general public UDP media proxy for WebRTC.

Remote host:

- SSH target for read-only/debug status: `admin@193.180.209.191`
- Key path used locally: `~/demo_private_key.pem`
- Workspace: `~/explorerWorkspace`
- Router port: `8097`

Production was deployed through GitHub Actions, not by direct mutation over SSH.

Current deployed commits after the latest production deploy:

- `AssistOSExplorer`: `d097617` (`Avoid eager WebMeet video recovery`)
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
  force_tcp: true
  node_ip: 193.180.209.191
```

Repository variables set for production:

- `WEBMEET_LIVEKIT_FORCE_TCP=true`
- `WEBMEET_LIVEKIT_LOG_LEVEL=info`

Required GitHub secrets remain secret-only and must not be printed:

- `SSH_KEY`
- `PLOINKY_MASTER_KEY`
- `SOUL_GATEWAY_API_KEY` if the deployment needs Soul Gateway integration

## High-Level Outcome

The remote black-screen screen-share issue is fixed in the current production configuration by forcing LiveKit media over TCP.

Final three-user Playwright browser smoke against `https://skills.axiologic.dev`:

- Artifact directory: `/tmp/webmeet-screen-diag-1778230127397`
- Test room: `diag-1778230127397`
- Admin account published a screen share.
- Daniel and Mircea accounts joined with the admin password, received, decoded, and displayed the screen share.
- Daniel receiver video state:
  - `readyState: 4`
  - `videoWidth: 1280`
  - `videoHeight: 720`
  - `framesDecoded: 147`
  - `framesReceived: 147`
  - `keyFramesDecoded: 1`
  - `bytesReceived: 952697`
- Mircea receiver video state:
  - `readyState: 4`
  - `videoWidth: 1280`
  - `videoHeight: 720`
  - `framesDecoded: 147`
  - `framesReceived: 147`
  - `keyFramesDecoded: 1`
  - `bytesReceived: 952697`
- Selected receiver media candidate for both receivers:
  - `candidateType: host`
  - `protocol: tcp`
  - `address: 193.180.209.191`
  - `port: 7881`

The latest `force_tcp=false` production canary failed even after `livekit-skills.axiologic.dev` was moved off the Cloudflare Tunnel and through the host/Nginx path. Browsers selected direct UDP host candidates on `193.180.209.191:7882-7892`, but receivers saw almost no media bytes and decoded no frames. Forcing TCP selected `193.180.209.191:7881` and both receivers decoded the screen share.

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

- Multiple accounts could log in and join a room.
- Admin could start screen share.
- Daniel and Mircea saw signaled/subscribed tracks, but the video stayed black in the UDP canary.
- Receivers had `videoWidth: 0`, `videoHeight: 0`, `readyState: 0`, a live attached track, and almost no inbound RTP.
- Local deployment worked, so the problem was topology/environment-specific.

Evidence gathered:

- Browser-side diagnostics showed the receiver had a track element but did not decode useful frames.
- The final failed UDP canary selected direct UDP host candidates on `193.180.209.191:7882-7892`.
- Daniel and Mircea each received only about 1.3 KB on the nominated UDP candidate pair and had no inbound decoded video frames.
- Admin local preview was healthy and the publisher encoded frames, so capture and publishing were not dead.
- The dashboard subscription recovery path resubscribed and reattached remote video tracks, but media still did not arrive over UDP.
- The forced-TCP run selected TCP host candidates on `193.180.209.191:7881` and both receivers decoded `1280x720` video frames.

Root cause:

- Signaling and room subscription are healthy.
- The production UDP media path is currently unreliable for this WebMeet path even when direct UDP host candidates are selected.
- Nginx only handles LiveKit HTTPS/WebSocket signaling; it does not proxy WebRTC UDP media.
- Forcing LiveKit media to TCP bypasses the failing UDP path and delivers screen-share frames reliably through the exposed LiveKit TCP media port.
- The remaining UDP question is below the dashboard and token layers: host firewall, provider filtering, NAT, local/client network behavior, or LiveKit UDP handling should be investigated with packet-level diagnostics before returning production to UDP.

Important Cloudflare documentation:

- Cloudflare Tunnel public hostname protocols list HTTP/HTTPS/WebSocket-style routing and TCP-over-WebSocket with client-side `cloudflared`, not generic UDP public routing:
  - `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/`
  - `https://developers.cloudflare.com/tunnel/routing/`
- Cloudflare Spectrum is the UDP-capable product, but Spectrum with Cloudflare Tunnel is only supported for HTTP/HTTPS origins, not generic TCP/UDP Tunnel origins:
  - `https://developers.cloudflare.com/spectrum/reference/limitations/`

Fix:

- Added configurable LiveKit `rtc.force_tcp`.
- Set production `WEBMEET_LIVEKIT_FORCE_TCP=true` and left it enabled after the final three-user smoke passed.
- Deployed through `.github/workflows/deploy-skills-explorer.yml`.

Relevant commits:

- `webmeetInfra` `f123a45` `Allow forcing LiveKit TCP media`
- `AssistOSExplorer` `8e1a4fd` `Pass LiveKit TCP media setting during deploy`
- `AssistOSExplorer` `6662e3a` `Refresh stuck WebMeet screen share downtracks`
- `AssistOSExplorer` `d097617` `Avoid eager WebMeet video recovery`

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

- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/livekit-room-controller.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/media-settings-methods.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/room-session-methods.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/webmeet-media-controller.js`
- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/services/media-diagnostics.js`
- `webmeetAgent/docs/specs/DS08-room-types.md`

Behavior:

- Screen-share publish uses explicit non-simulcast settings.
- Media diagnostics are gated behind `WEBMEET_MEDIA_DEBUG` or `webmeetMediaDebug=1`.
- Diagnostics log connect, publish, subscribe, attachment, and video-readiness events.

#### Duplicate track attach guard

Commit: `1279d55` `Avoid duplicate WebMeet video attachments`

Key file:

- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/room-session-methods.js`

Behavior:

- If a subscribed track with the same `trackSid` already has an element, skip duplicate attachment.
- Prevents repeated replacement of an otherwise valid video element.

#### Bounded remote-video recovery

Commits:

- `6662e3a` `Refresh stuck WebMeet screen share downtracks`
- `d097617` `Avoid eager WebMeet video recovery`

Key files:

- `webmeetAgent/IDE-plugins/webmeet-tool-button/components/webmeet-dashboard-modal/controllers/room-session-methods.js`
- `webmeetAgent/docs/specs/DS10-livekit-media-runtime.md`
- `webmeetAgent/docs/index.html`

Behavior:

- Adds a bounded remote-video recovery path for subscribed video publications whose attached element remains without decoded frames after the readiness window.
- Recovery detaches the stale element and toggles the LiveKit publication subscription off/on, capped at two attempts per publication.
- The follow-up commit prevents disconnected stale element timers from firing and avoids eager recovery during the normal first-frame wait.
- Final production smoke with `force_tcp=true` did not need recovery; the remote video reached `loadedmetadata`, `playing`, and readiness checks stayed `true`.

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

Current production value is `true`.

## Deployment Actions Run

Production deploys used GitHub Actions workflow:

```text
.github/workflows/deploy-skills-explorer.yml
```

Relevant successful runs:

- `25545810338`
  - Deployed `AssistOSExplorer` `6662e3a`
  - Kept `force_tcp: false`
  - Three-user remote browser test still failed over UDP
  - Artifact: `/tmp/webmeet-screen-diag-1778229427940`
- `25546092158`
  - Deployed `AssistOSExplorer` `6662e3a`
  - Set `force_tcp: true`
  - Three-user remote browser test passed over TCP `193.180.209.191:7881`
  - Artifact: `/tmp/webmeet-screen-diag-1778229831655`
- `25546306752`
  - Deployed `AssistOSExplorer` `d097617`
  - Kept `force_tcp: true`
  - Final three-user remote browser test passed over TCP `193.180.209.191:7881`
  - Artifact: `/tmp/webmeet-screen-diag-1778230127397`
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
  - Browser smoke decoded and displayed screen share over UDP at that point, but later three-user tests reproduced the UDP failure

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

Temporary harness paths:

```text
/tmp/webmeet-playwright/diag.mjs
/tmp/webmeet-playwright/diag3.mjs
```

The current final harness is `diag3.mjs`. The older `diag.mjs` is still useful for two-user checks.

The harness:

- Opens isolated headless browser contexts.
- Logs in as `admin`, `daniel`, and, for `diag3.mjs`, `mircea`.
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
node /tmp/webmeet-playwright/diag3.mjs
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
- Receiver remote candidate protocol is `tcp` on `193.180.209.191:7881` for the current production topology.

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

## Why TCP Is The Current Production Fix

LiveKit has two planes:

- Signaling: HTTPS/WebSocket. This works through Cloudflare Tunnel.
- Media: WebRTC ICE/SRTP. By default this prefers UDP. Cloudflare Tunnel public hostnames do not proxy arbitrary browser UDP media to the origin.

Before the fix, the room could join and tracks could be signaled, but subscribers could not receive usable screen-share keyframes over the UDP media path. The latest failed UDP canary happened after `livekit-skills.axiologic.dev` was moved to direct DNS/Nginx signaling: receivers selected direct UDP host candidates but still received almost no media and decoded no frames.

`rtc.force_tcp: true` proved that the issue is transport-related and below the WebMeet dashboard/subscription layer. With TCP forced, browsers selected the LiveKit TCP media candidate on `193.180.209.191:7881`, and both receivers decoded and displayed frames.

Tradeoffs:

- TCP is currently more reliable through this topology.
- TCP can add latency under packet loss due to retransmission and head-of-line blocking.
- Screen share tolerates this better than low-latency camera/audio.
- For higher scale or lower latency, investigate why direct UDP host candidates are not carrying subscriber media before returning production to `force_tcp=false`. A TURN/TLS relay on port `443` is another controlled fallback path for restrictive networks.

## Remaining Risks And Follow-Ups

Known fixed:

- Fresh deployment no longer requires manually configured LiveKit API key/secret.
- Local LiveKit invalid API key mismatch was fixed by shared derived media secrets.
- Remote screen-share black receiver is fixed in production by forcing TCP media.
- LiveKit production log level is back to `info`.

Risks:

- Production currently depends on LiveKit TCP media at `193.180.209.191:7881`.
- UDP media on `193.180.209.191:7882-7892/udp` currently negotiates but fails to deliver usable subscriber video in the three-user remote test.
- Signaling can be proxied by Nginx, but normal HTTP reverse proxying does not carry WebRTC UDP media.
- The browser diagnostic harness is temporary under `/tmp`. If this test should be reusable, move it into a committed test location and scrub any environment-specific assumptions.
- If production topology changes back to a pure tunnel/proxy setup, keep `WEBMEET_LIVEKIT_FORCE_TCP=true` unless another tested media path is available.

Recommended next tasks:

1. Add a committed WebMeet screen-share Playwright smoke test that redacts sensitive data by design.
2. Keep the production Cloudflare Tunnel limitation documented in `webmeetAgent/docs/specs/DS10-livekit-media-runtime.md`.
3. Investigate the UDP failure with packet-level host/network diagnostics before attempting another `force_tcp=false` canary.
4. Decide whether forced TCP is acceptable long term, whether direct UDP can be made reliable, or whether to use TURN/TLS on `443`.
5. If scaling WebMeet usage, load test LiveKit with the current TCP media path and any future UDP path before relying on it for larger meetings.
6. Keep the derived-secret invariant strict. Do not reintroduce manual LiveKit/TURN fallback credentials.

## Recovery Checklist

If screen share regresses:

1. Confirm production is on the expected commits.
2. Confirm generated LiveKit config has `force_tcp: true` for the current production topology.
3. Confirm GitHub repo variable `WEBMEET_LIVEKIT_FORCE_TCP` is `true`.
4. Confirm Cloudflare DNS sends `livekit-skills.axiologic.dev` directly to the LiveKit/Nginx host, not to a Tunnel public hostname.
5. Run the three-browser harness and inspect Daniel and Mircea receiver `framesDecoded`.
6. Inspect candidate stats. Passing production should select `tcp` to `193.180.209.191:7881`.
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
