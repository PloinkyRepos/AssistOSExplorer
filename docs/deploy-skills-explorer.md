# Deploy Skills Explorer

This document describes the GitHub Actions deployment for the Explorer agent on `skills.axiologic.dev`.

## Ploinky Runtime Release

The `deploy-skills-explorer.yml` workflow checks out the immutable Ploinky
release tag `v1.0.0` by default. This release points to the Ploinky `master`
commit selected for Explorer deployment. The workflow accepts only a Ploinky
tag through the `ploinky_tag` dispatch input or `PLOINKY_TAG` repository
variable; it does not deploy from a moving Ploinky branch.

Publish a new Ploinky release tag before changing this pin. An explicit
`ploinky_tag` dispatch input overrides the repository variable, and the
repository variable overrides the workflow default.

## GitHub Secrets

Create or update these repository secrets in `AssistOS-AI/AssistOSExplorer`.

```sh
gh secret set SSH_KEY --repo AssistOS-AI/AssistOSExplorer < ~/.ssh/skills-explorer-deploy
gh secret set PLOINKY_MASTER_KEY --repo AssistOS-AI/AssistOSExplorer --body "$(openssl rand -hex 32)"
```

`PLOINKY_MASTER_KEY` must be exactly 64 hex characters. Keep it stable after the first deployment because it encrypts the Ploinky workspace secret stores and local-auth password store.

`ONLYOFFICE_JWT_SECRET` is not configured as a GitHub secret for the managed Document Server. Explorer derives `ONLYOFFICE_JWT_SECRET` through its Ploinky manifest, and the `onlyOffice` Ploinky agent derives its container `JWT_SECRET` from the same `AchillesIDE/explorer/ONLYOFFICE_JWT_SECRET` identity. Explorer's host preinstall hook no longer computes or injects the Document Server secret.
OnlyOfficeAgent also sets `ALLOW_PRIVATE_IP_ADDRESS=true` so the bundled Document Server can fetch the decorator's signed `127.0.0.1` document and callback URLs. Do not set `ALLOW_META_IP_ADDRESS`; metadata-address fetches are not part of the Office storage flow.
WebMeet LiveKit and TURN credentials are also manifest-derived, using the same shared derivation identity across `webmeetAgent`, `webmeetLivekitAiAgent`, and `webmeetInfra/liveKitServerAgent`; do not configure them as GitHub secrets for the deploy workflow.

The centralized image-build repository needs a Docker Hub token for the manual image publish workflows:

```sh
gh secret set DOCKERHUB_TOKEN --repo AssistOS-AI/container-image-builds
```

The token value must stay only in GitHub Actions secrets.

## Explorer Public Access

`skills.axiologic.dev` is fronted by a Cloudflare Zero Trust tunnel running as a podman container on the host. The tunnel terminates TLS at Cloudflare's edge and forwards directly to the Explorer router on `127.0.0.1:${EXPLORER_ROUTER_PORT}` (default `8097`). The workflow does **not** manage the tunnel; ingress is configured in the Cloudflare Zero Trust dashboard. To change the routing target, edit the tunnel's public hostname configuration in the dashboard rather than touching the workflow.

## LiveKit Public Access

WebMeet uses a separate public LiveKit endpoint:

```text
wss://livekit-skills.axiologic.dev
```

Production routing uses a DNS-only A record for `livekit-skills.axiologic.dev` pointing to `193.180.209.191`, not the Cloudflare tunnel. The unified `webmeetInfra/liveKitServerAgent` runs on the host network in the `prod` profile, owns ports `80` and `443`, terminates TLS with its supervised Nginx/Certbot processes, and proxies LiveKit WebSocket/API traffic to LiveKit on `127.0.0.1:7880`.

The deploy workflow migrates production away from the retired split WebMeet infra agents by disabling and scrubbing `webmeetInfra/stack`, `webmeetCoturn`, `webmeetRedis`, `webmeetLivekitServer`, `webmeetLivekitEgress`, `webmeetLivekitNginx`, and `webmeetLivekitCertbot` before starting Explorer. The replacement image is pulled from Docker Hub as `docker.io/assistos/livekit-server-agent:${WEBMEET_INFRA_IMAGE_TAG}`.

The optional `webmeetLivekitAiAgent` worker is not launched by the default Explorer stack. If a separate worker stack enables it, the `prod` profile runs on the host network so its server-side WebRTC connection uses the same host-network topology as LiveKit. Its manifest supplies a separate `WEBMEET_LIVEKIT_AGENT_URL` default of `http://127.0.0.1:7880`; do not point it at the bridge-only `WEBMEET_LIVEKIT_URL` unless the worker network topology changes too.

If `livekit-skills.axiologic.dev` is moved behind Cloudflare/Tunnel later, retest WebMeet before changing the manifest because Cloudflare Tunnel does not provide the public UDP media path used by LiveKit.

## GitHub Variables

Create or update these repository variables. WebMeet topology variables are optional overrides: the `prod` manifest profiles already carry the Axiologic production defaults for the public LiveKit URL, internal LiveKit API URL, egress URL, TLS hostname/email, TURN realm, and TURN hostname. Keep the variables below when intentionally overriding the profile defaults from GitHub Actions.
The deploy workflow omits blank optional variables from the remote environment so empty repository variables do not shadow manifest profile defaults.
`PLOINKY_TAG` is optional; when it is unset, the workflow deploys `v1.0.0`.

```sh
gh variable set SSH_USER --repo AssistOS-AI/AssistOSExplorer --body admin
gh variable set SSH_HOST --repo AssistOS-AI/AssistOSExplorer --body 193.180.209.191
gh variable set EXPLORER_WORKSPACE --repo AssistOS-AI/AssistOSExplorer --body explorerWorkspace
gh variable set EXPLORER_ROUTER_PORT --repo AssistOS-AI/AssistOSExplorer --body 8097
gh variable set EXPLORER_PUBLIC_URL --repo AssistOS-AI/AssistOSExplorer --body https://skills.axiologic.dev
gh variable set PLOINKY_PROFILE --repo AssistOS-AI/AssistOSExplorer --body prod
gh variable set ONLYOFFICE_PUBLIC_URL --repo AssistOS-AI/AssistOSExplorer --body https://office.axiologic.dev
gh variable set ONLYOFFICE_CALLBACK_BASE_URL --repo AssistOS-AI/AssistOSExplorer --body https://skills.axiologic.dev
gh variable set WEBMEET_PUBLIC_LIVEKIT_URL --repo AssistOS-AI/AssistOSExplorer --body wss://livekit-skills.axiologic.dev
gh variable set WEBMEET_LIVEKIT_URL --repo AssistOS-AI/AssistOSExplorer --body http://host.containers.internal:7880
gh variable set WEBMEET_EGRESS_URL --repo AssistOS-AI/AssistOSExplorer --body http://host.containers.internal:7980
gh variable set WEBMEET_INFRA_IMAGE_TAG --repo AssistOS-AI/AssistOSExplorer --body webmeet-infra
gh variable set PLOINKY_NODE_IMAGE_TAG --repo AssistOS-AI/AssistOSExplorer --body 24-bookworm-tools
gh variable set WEBMEET_LIVEKIT_USE_EXTERNAL_IP --repo AssistOS-AI/AssistOSExplorer --body false
gh variable set WEBMEET_LIVEKIT_NODE_IP --repo AssistOS-AI/AssistOSExplorer --body 193.180.209.191
gh variable set WEBMEET_LIVEKIT_UPSTREAM --repo AssistOS-AI/AssistOSExplorer --body http://127.0.0.1:7880
gh variable set WEBMEET_TLS_HOSTNAME --repo AssistOS-AI/AssistOSExplorer --body livekit-skills.axiologic.dev
gh variable set WEBMEET_CERT_EMAIL --repo AssistOS-AI/AssistOSExplorer --body research@axiologic.net
gh variable set WEBMEET_CERTBOT_AUTO_ISSUE --repo AssistOS-AI/AssistOSExplorer --body true
gh variable set WEBMEET_TURN_HOST --repo AssistOS-AI/AssistOSExplorer --body livekit-skills.axiologic.dev
gh variable set WEBMEET_TURN_REALM --repo AssistOS-AI/AssistOSExplorer --body skills.axiologic.dev
gh variable set WEBMEET_TURN_USER --repo AssistOS-AI/AssistOSExplorer --body webmeet
gh variable set WEBMEET_TURN_MIN_PORT --repo AssistOS-AI/AssistOSExplorer --body 20000
gh variable set WEBMEET_TURN_MAX_PORT --repo AssistOS-AI/AssistOSExplorer --body 20010
gh variable set STRICT_INFRA_CHECKS --repo AssistOS-AI/AssistOSExplorer --body 0
```

Set `WEBMEET_TURN_EXTERNAL_IP` only when coturn must use an explicit public IP instead of resolving `WEBMEET_TURN_HOST` at startup.
Set `STRICT_INFRA_CHECKS=1` only when local LiveKit and OnlyOffice health failures should fail the deployment; the default `0` matches the QA-tested non-strict infra gate.
Leave `ONLYOFFICE_INTERNAL_URL` unset for the managed OnlyOffice agent. The agent defaults its in-container Document Server target to `http://127.0.0.1:80`, while the workflow health probe falls back to the host-facing editor proxy at `http://127.0.0.1:8082`. Remove any legacy repository variable that points `ONLYOFFICE_INTERNAL_URL` at `http://127.0.0.1:8082` before deploying:

```sh
gh variable delete ONLYOFFICE_INTERNAL_URL --repo AssistOS-AI/AssistOSExplorer
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
  -f source_ref=main \
  -f image_tag=webmeet-infra
```

Run the `Deploy Skills Explorer` workflow for normal updates:

Normal production deploys can omit `ploinky_branch` and `achilles_branch`; the workflow defaults both Ploinky runtime dependencies to `master` because those repositories do not publish `main` as their current canonical branch.

```sh
gh workflow run deploy-skills-explorer.yml \
  --repo AssistOS-AI/AssistOSExplorer \
  -f branch=main \
  -f workspace_name=explorerWorkspace \
  -f router_port=8097 \
  -f public_url=https://skills.axiologic.dev \
  -f profile=prod \
  -f webmeet_infra_image_tag=webmeet-infra \
  -f ploinky_node_image_tag=24-bookworm-tools

# Feature-branch deploy (all repos on same branch):
gh workflow run deploy-skills-explorer.yml \
  --repo AssistOS-AI/AssistOSExplorer \
  --ref soul-gateway-ploinky-agent \
  -f branch=soul-gateway-ploinky-agent \
  -f proxies_branch=soul-gateway-ploinky-agent \
  -f ploinky_branch=soul-gateway-ploinky-agent \
  -f achilles_branch=soul-gateway-ploinky-agent
```

The workflow:

1. Connects to `SSH_USER@SSH_HOST` with `SSH_KEY`.
2. Resolves the installed `ploinky` binary and verifies required host tools are already present.
3. Pins `PLOINKY_WORKSPACE_ROOT` to the requested workspace so Ploinky commands cannot resolve to a stale parent workspace.
4. Stops the current workspace only when its `.ploinky/routing.json` owns `EXPLORER_ROUTER_PORT`; otherwise it skips shutdown for cold workspaces and refuses to start when the port is already held by an unowned process.
5. Puts the Ploinky runtime checkout on `ploinky_branch` and `achillesAgentLib` on `achilles_branch`.
6. Installs the `AchillesIDE`, `webmeetInfra`, and `proxies` repos with the current `ploinky install ... --branch` command shape.
7. Runs `ploinky update` so Ploinky updates the workspace repos and local Ploinky dependencies.
8. Hard-resets the remote Ploinky-managed repo checkouts to the requested branches.
9. Removes retired split WebMeet infra registrations and containers before the unified agent starts.
10. Stores configured runtime variable overrides through `ploinky var`.
11. Pulls `docker.io/assistos/ploinky-node:${PLOINKY_NODE_IMAGE_TAG}` and `docker.io/assistos/livekit-server-agent:${WEBMEET_INFRA_IMAGE_TAG}` before startup, so cold deployments use published runtime images instead of ad hoc package installation.
12. Starts `AchillesIDE/explorer` on `EXPLORER_ROUTER_PORT` with branch-aware flags (`--branch`, `--repo-branch`, `--reset-repos`).
13. Verifies local router health, checks `liveKitServerAgent` and OnlyOffice `api.js` as non-fatal infra gates unless `STRICT_INFRA_CHECKS=1`, verifies public `EXPLORER_PUBLIC_URL` access through the Cloudflare tunnel, verifies public `WEBMEET_PUBLIC_LIVEKIT_URL`, and verifies browser-visible OnlyOffice `api.js` through the required `ONLYOFFICE_PUBLIC_URL`.
