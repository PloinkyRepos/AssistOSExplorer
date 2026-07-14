# Deploy Skills Explorer

This document describes the GitHub Actions deployment for the Explorer agent on `skills.axiologic.dev`.

## GitHub Secrets

Create or update these repository secrets in `AssistOS-AI/AssistOSExplorer`.

```sh
gh secret set SSH_KEY --repo AssistOS-AI/AssistOSExplorer < ~/.ssh/skills-explorer-deploy
gh secret set PLOINKY_MASTER_KEY --repo AssistOS-AI/AssistOSExplorer --body "$(openssl rand -hex 32)"
gh secret set WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN --repo AssistOS-AI/AssistOSExplorer --body "<scoped tunnel token>"
# Optional for separately invoked Web Publishing admin/API tools; the managed deploy does not apply Cloudflare mutations:
gh secret set WEB_PUBLISHING_CLOUDFLARE_API_TOKEN --repo AssistOS-AI/AssistOSExplorer --body "<cloudflare api token>"
```

`PLOINKY_MASTER_KEY` must be exactly 64 hex characters. Keep it stable after the first deployment because it encrypts the Ploinky workspace secret stores and local-auth password store.

`ONLYOFFICE_JWT_SECRET` is not configured as a GitHub secret for the managed Document Server. Explorer derives `ONLYOFFICE_JWT_SECRET` through its Ploinky manifest, and the `onlyOffice` Ploinky agent derives its container `JWT_SECRET` from the same `AchillesIDE/explorer/ONLYOFFICE_JWT_SECRET` identity. Explorer's host preinstall hook no longer computes or injects the Document Server secret.
OnlyOfficeAgent also sets `ALLOW_PRIVATE_IP_ADDRESS=true` so the bundled Document Server can fetch the decorator's signed `127.0.0.1` document and callback URLs. Do not set `ALLOW_META_IP_ADDRESS`; metadata-address fetches are not part of the Office storage flow.
WebMeet LiveKit credentials and the independent TURN REST authentication secret are manifest-derived shared secrets; do not configure them as GitHub secrets for the deploy workflow. `webmeetAgent` never receives the TURN secret or an individual TURN credential.

The centralized image-build repository needs a Docker Hub token for the manual image publish workflows:

```sh
gh secret set DOCKERHUB_TOKEN --repo AssistOS-AI/container-image-builds
```

The token value must stay only in GitHub Actions secrets.

## Explorer Public Access

`skills.axiologic.dev` is fronted by the Web Publishing agent (`basic/web-publishing`). Web Publishing generates the Explorer, OnlyOffice, and WebMeet public topology before dependent agents resolve their environment. Managed token modes use a pre-provisioned scoped Cloudflare tunnel token; the workflow rejects `WEB_PUBLISHING_MODE=cloudflare-api` because it does not invoke externally mutating tunnel or DNS apply operations. Operators must provision the tunnel and DNS records separately before deployment. The workflow clears stale direct public topology variables before startup so generated values cannot be shadowed by old GitHub variables.

## LiveKit Public Access

WebMeet uses a dedicated browser-facing signaling endpoint:

```text
wss://meet.axiologic.dev
```

Web Publishing owns this URL and proxies only `/rtc` signaling to the private `http://livekitserveragent:7880` endpoint whose DNS identity Ploinky derives on `webmeet-signaling`. `WEB_PUBLISHING_TLS_EDGE=cloudflare` declares Cloudflare as the trusted WSS terminator; its same-container connector is `127.0.0.1:18081` and accepts client identity only from Cloudflare's overwritten `CF-Connecting-IP` header. `external` declares a separately managed trusted terminator; that proxy must connect to the host-loopback-only `127.0.0.1:18083` connector, preserve the canonical `meet.<base-domain>` Host header, validate and overwrite `X-Real-IP`, and present a browser-trusted certificate. Neither connector may be placed on a public or untrusted network. Raw port `8081` is not a public WSS origin in these modes, and raw LiveKit `7880`, Redis, Egress, and readiness endpoints remain private. LiveKit media reaches the explicit `WEB_PUBLISHING_LIVEKIT_MEDIA_IP` directly, outside the HTTP tunnel.

TURN uses the separate DNS-only `turn.axiologic.dev` hostname and the explicit `WEB_PUBLISHING_TURN_EXTERNAL_IP`. Production publishes TURN/UDP on `3478` and TURN/TLS on the separate public L4 endpoint at `443/tcp`, mapped to Coturn's private `5349` TLS listener; plaintext TURN/TCP `3478` is not published in production. Relay allocations use the bounded infra-manifest range. TURN traffic must never be sent through the Web Publishing HTTP tunnel.

Before running the workflow, provision these two files on the target host under the selected workspace:

```text
~/explorerWorkspace/.ploinky/data/webmeetTls/turn/fullchain.pem
~/explorerWorkspace/.ploinky/data/webmeetTls/turn/privkey.pem
```

They must be readable regular files, not symlinks. The certificate must be unexpired and cover `turn.<WEB_PUBLISHING_BASE_DOMAIN>`, and its public key must match `privkey.pem`. The workflow validates all of those conditions before it stops the existing workspace, updates any repository, pulls an image, or starts an agent. It never generates or replaces the operator-owned certificate.

For every accepted managed public mode, create the `turn.<WEB_PUBLISHING_BASE_DOMAIN>` DNS `A` record before deployment. Every resolved IPv4 address must equal `WEB_PUBLISHING_TURN_EXTERNAL_IP`, and the IPv4-only TURN hostname must have no `AAAA` record. The workflow accepts only a canonical lowercase DNS base domain and bare unicast, non-loopback IPv4 media and TURN addresses; it checks those inputs and both DNS address families early and fails instead of proceeding with invalid, absent, mismatched, or IPv6 results. An unexpected `AAAA` lookup error also fails closed because the workflow cannot prove that the IPv4-only endpoint has no IPv6 address. DNS resolution cannot establish the Cloudflare proxy flag, so the operator must separately confirm that this record is **DNS-only**; TURN must not use Cloudflare's HTTP proxy.

Mode and edge ownership must also agree: `nginx` requires `WEB_PUBLISHING_TLS_EDGE=external`; `cloudflare-token`, `token`, and `nginx-cloudflare` require `WEB_PUBLISHING_TLS_EDGE=cloudflare`. The runner rejects incompatible pairs before opening the remote deployment path.

The deploy workflow migrates production away from retired WebMeet infra registrations by disabling and scrubbing `webmeetInfra/stack`, `webmeetCoturn`, `webmeetRedis`, `webmeetLivekitServer`, `webmeetLivekitEgress`, `webmeetLivekitNginx`, and `webmeetLivekitCertbot` before starting Explorer. The current split is `liveKitServerAgent` plus `turnServerAgent`; the LiveKit image is pulled as the manifest-canonical `docker.io/assistos/livekit-server-agent:webmeet-infra`.

The optional `webmeetLivekitAiAgent` worker is not launched by the default Explorer stack. A separately deployed worker must be given a network path to the private LiveKit API/signaling service; it must not rely on the retired host-network topology or raw public `7880`.

Cloudflare Tunnel can carry scoped WSS signaling but does not provide LiveKit's public UDP media path or a general TURN L4 proxy. Keep the media and TURN IP inputs explicit and independently reachable.

## GitHub Variables

Create or update these repository variables. Public topology uses Web Publishing-scoped inputs; do not set provider outputs such as `ONLYOFFICE_*` or public `WEBMEET_*` topology directly in GitHub Actions.
The deploy workflow omits blank optional variables from the remote environment so empty repository variables do not shadow manifest profile defaults.

```sh
gh variable set SSH_USER --repo AssistOS-AI/AssistOSExplorer --body admin
gh variable set SSH_HOST --repo AssistOS-AI/AssistOSExplorer --body 193.180.209.191
gh variable set EXPLORER_WORKSPACE --repo AssistOS-AI/AssistOSExplorer --body explorerWorkspace
gh variable set EXPLORER_ROUTER_PORT --repo AssistOS-AI/AssistOSExplorer --body 8097
gh variable set EXPLORER_PUBLIC_URL --repo AssistOS-AI/AssistOSExplorer --body https://skills.axiologic.dev
gh variable set PLOINKY_PROFILE --repo AssistOS-AI/AssistOSExplorer --body prod
gh variable set WEB_PUBLISHING_MODE --repo AssistOS-AI/AssistOSExplorer --body nginx-cloudflare
gh variable set WEB_PUBLISHING_BASE_DOMAIN --repo AssistOS-AI/AssistOSExplorer --body axiologic.dev
gh variable set WEB_PUBLISHING_PUBLIC_URL --repo AssistOS-AI/AssistOSExplorer --body https://skills.axiologic.dev
gh variable set WEB_PUBLISHING_TLS_EDGE --repo AssistOS-AI/AssistOSExplorer --body cloudflare
gh variable set WEB_PUBLISHING_LIVEKIT_MEDIA_IP --repo AssistOS-AI/AssistOSExplorer --body 193.180.209.191
gh variable set WEB_PUBLISHING_TURN_EXTERNAL_IP --repo AssistOS-AI/AssistOSExplorer --body 193.180.209.191
gh variable set PLOINKY_NODE_IMAGE_TAG --repo AssistOS-AI/AssistOSExplorer --body 24-bookworm-tools
gh variable set BASIC_BRANCH --repo AssistOS-AI/AssistOSExplorer --body ploinky-box
gh variable set WEBMEET_INFRA_BRANCH --repo AssistOS-AI/AssistOSExplorer --body ploinky-box
```

`WEB_PUBLISHING_LIVEKIT_MEDIA_IP` and `WEB_PUBLISHING_TURN_EXTERNAL_IP` are mandatory, independent production inputs; do not replace them with downstream `WEBMEET_*` overrides. Web Publishing derives public hostnames from its canonical base-domain and route inputs.
OnlyOffice and the WebMeet signaling/media chain enforce readiness through blocking in-container Ploinky probes. Optional STT remains an isolated `no-wait` dependency; its private health script supports direct starts and watchdog monitoring without gating Explorer startup. The deployment workflow does not probe `ONLYOFFICE_INTERNAL_URL` from the remote host because Web Publishing generates it as the OnlyOffice container's co-located Document Server target, `http://127.0.0.1:80`. Browser-visible validation instead uses generated `ONLYOFFICE_PUBLIC_URL` from the runner and fails closed. Cross-container Web Publishing traffic reaches the editor proxy as `http://onlyoffice:8080` on `office-publishing`. Remove legacy public topology repository variables before deploying:

```sh
gh variable delete ONLYOFFICE_PUBLIC_URL --repo AssistOS-AI/AssistOSExplorer
gh variable delete ONLYOFFICE_INTERNAL_URL --repo AssistOS-AI/AssistOSExplorer
gh variable delete ONLYOFFICE_CALLBACK_BASE_URL --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_PUBLIC_LIVEKIT_URL --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_LIVEKIT_URL --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_TLS_HOSTNAME --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_LIVEKIT_UPSTREAM --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_CERT_EMAIL --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_TURN_EXTERNAL_IP --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_TURN_HOST --repo AssistOS-AI/AssistOSExplorer
gh variable delete WEBMEET_TURN_REALM --repo AssistOS-AI/AssistOSExplorer
```

## Provision Host

Run `Provision Skills Explorer Host` only when the remote host needs OS packages, Node.js, Podman, Ploinky, or `achillesAgentLib` installed or refreshed.

## Deploy Or Update

Before deploying production changes that alter the shared Node runtime image, publish it from the centralized image-build repository:

```sh
gh workflow run publish-ploinky-node-image.yml \
  --repo AssistOS-AI/container-image-builds \
  -f image_tag=24-bookworm-tools
```

Before deploying production changes that alter `webmeetInfra/liveKitServerAgent`, publish the image from the centralized image-build repository:

```sh
gh workflow run publish-livekit-server-agent.yml \
  --repo AssistOS-AI/container-image-builds \
  -f source_ref="$(git -C /path/to/webmeetInfra rev-parse ploinky-box)" \
  -f image_tag=webmeet-infra
```

`source_ref` must be the exact lowercase 40-character commit SHA at the remote
`webmeetInfra` `ploinky-box` tip. The publication workflow rejects branch names,
non-tip commits, and mutable refs before it logs in or pushes an image.

Run the `Deploy Skills Explorer` workflow for normal updates:

Normal production deploys can omit `ploinky_branch` and `achilles_branch`. The workflow defaults the Ploinky runtime itself to `ploinky-box`, which contains the startup config-provider and blocking graph-readiness contracts used by this stack; `achillesAgentLib` continues to default to its canonical `master` branch. A non-git Ploinky installation is rejected because the workflow cannot prove or reset its branch.

```sh
gh workflow run deploy-skills-explorer.yml \
  --repo AssistOS-AI/AssistOSExplorer \
  -f branch=ploinky-box \
  -f basic_branch=ploinky-box \
  -f webmeet_infra_branch=ploinky-box \
  -f workspace_name=explorerWorkspace \
  -f router_port=8097 \
  -f public_url=https://skills.axiologic.dev \
  -f profile=prod \
  -f ploinky_node_image_tag=24-bookworm-tools

# Feature-branch deploy (all repos on same branch):
gh workflow run deploy-skills-explorer.yml \
  --repo AssistOS-AI/AssistOSExplorer \
  --ref soul-gateway-ploinky-agent \
  -f branch=soul-gateway-ploinky-agent \
  -f basic_branch=soul-gateway-ploinky-agent \
  -f webmeet_infra_branch=soul-gateway-ploinky-agent \
  -f proxies_branch=soul-gateway-ploinky-agent \
  -f ploinky_branch=soul-gateway-ploinky-agent \
  -f achilles_branch=soul-gateway-ploinky-agent
```

The workflow:

1. Connects to `SSH_USER@SSH_HOST` with `SSH_KEY`.
2. Resolves the installed `ploinky` binary and verifies required host tools, including OpenSSL, are already present.
3. Pins `PLOINKY_WORKSPACE_ROOT` to the requested workspace so Ploinky commands cannot resolve to a stale parent workspace.
4. Validates the canonical lowercase base domain, bare unicast/non-loopback media and TURN IPv4 addresses, mode/TLS-edge pairing, pre-provisioned TURN certificate/key, exact DNS `A` resolution, and absence of any `AAAA` record before any shutdown, repository update, image pull, or agent start.
5. Stops the current workspace only when its `.ploinky/routing.json` owns `EXPLORER_ROUTER_PORT`; otherwise it skips shutdown for cold workspaces and refuses to start when the port is already held by an unowned process.
6. Puts the Ploinky runtime checkout on `ploinky_branch` and `achillesAgentLib` on `achilles_branch`.
7. Installs the `AchillesIDE`, `basic`, `webmeetInfra`, and `proxies` repos with the current `ploinky install ... --branch` command shape.
8. Runs `ploinky update` so Ploinky updates the workspace repos and local Ploinky dependencies.
9. Hard-resets the remote Ploinky-managed repo checkouts to the requested branches.
10. Removes retired WebMeet infra registrations and containers before the split LiveKit/TURN agents start.
11. Clears stale downstream topology and retired TURN/health/TLS variables, then stores only scoped Web Publishing inputs and supported runtime tuning through `ploinky var`.
12. Pulls `docker.io/assistos/ploinky-node:${PLOINKY_NODE_IMAGE_TAG}`, `docker.io/assistos/web-publishing-agent:node24-nginx-cloudflared`, and `docker.io/assistos/livekit-server-agent:webmeet-infra` before startup, so cold deployments use published runtime images instead of ad hoc package installation.
13. Starts `AchillesIDE/explorer` on `EXPLORER_ROUTER_PORT` with explicit `--profile "$PLOINKY_PROFILE"` plus branch-aware flags (`--branch`, `--repo-branch`, `--reset-repos`) for Explorer, Basic, proxies, and WebMeet infra, while explicitly pinning `container-image-builds=main` so the global `ploinky-box` branch cannot select that repository's unrelated branch.
14. Waits for the `ploinky start` process to exit successfully before reading provider-owned topology, which proves its blocking dependency readiness chain completed; router polling then verifies the listener separately. It requires Web Publishing to emit exactly `wss://meet.<WEB_PUBLISHING_BASE_DOMAIN>` as `WEBMEET_PUBLIC_LIVEKIT_URL`. The workflow never converts an `http://` or `ws://` value into a trusted probe URL. From the runner it sends a bounded, bodyless HTTP/1.1 WebSocket-upgrade request to the canonical HTTPS hostname's exact `/rtc` route and requires LiveKit's unauthenticated `401` before success. It also verifies public `EXPLORER_PUBLIC_URL` access and browser-visible OnlyOffice `api.js` through generated `ONLYOFFICE_PUBLIC_URL`; no remote-host probe targets the container-local `ONLYOFFICE_INTERNAL_URL`.
