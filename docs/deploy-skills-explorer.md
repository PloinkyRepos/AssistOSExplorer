# Deploy Skills Explorer

This document describes the GitHub Actions deployment for the Explorer agent on `skills.axiologic.dev`.

## GitHub Secrets

Create or update these repository secrets in `PloinkyRepos/AssistOSExplorer`.

```sh
gh secret set SSH_KEY --repo PloinkyRepos/AssistOSExplorer < ~/.ssh/skills-explorer-deploy
gh secret set PLOINKY_MASTER_KEY --repo PloinkyRepos/AssistOSExplorer --body "$(openssl rand -hex 32)"
gh secret set SOUL_GATEWAY_API_KEY --repo PloinkyRepos/AssistOSExplorer
```

`PLOINKY_MASTER_KEY` must be exactly 64 hex characters. Keep it stable after the first deployment because it encrypts the Ploinky workspace secret stores and local-auth password store.
`SOUL_GATEWAY_API_KEY` is the production LLM credential for the standalone Soul Gateway. Leave `SOUL_GATEWAY_BASE_URL` unset for the normal production path so Achilles uses the configured `https://soul.axiologic.dev` provider URL.

`LMSTUDIO_PROXY_TOKEN` is only needed for deployments that leave `SOUL_GATEWAY_API_KEY` unset and use the embedded Soul Gateway's default local LLM endpoint, `https://lmstudio.axiologic.dev/v1`. The deploy workflow stores it as `LOCAL_LLM_API_KEY` through `ploinky var` so embedded Soul Gateway can create an encrypted provider account at startup. Use a `LOCAL_LLM_API_KEY` secret instead if the upstream endpoint token is not an LM Studio proxy token:

```sh
gh secret set LMSTUDIO_PROXY_TOKEN --repo PloinkyRepos/AssistOSExplorer
gh secret set LOCAL_LLM_API_KEY --repo PloinkyRepos/AssistOSExplorer
```

`ONLYOFFICE_JWT_SECRET` is not configured as a GitHub secret for the managed Document Server. Explorer derives `ONLYOFFICE_JWT_SECRET` through its Ploinky manifest, and the `onlyOffice` Ploinky agent derives its container `JWT_SECRET` from the same `AchillesIDE/explorer/ONLYOFFICE_JWT_SECRET` identity. Explorer's host preinstall hook no longer computes or injects the Document Server secret.
WebMeet LiveKit and TURN credentials are also manifest-derived, using the same shared derivation identity across `webmeetAgent`, `webmeetLivekitAiAgent`, and `webmeetInfra/liveKitServerAgent`; do not configure them as GitHub secrets for the deploy workflow.

The `PloinkyRepos/webmeetInfra` repository also needs a Docker Hub token for the manual image publish workflow:

```sh
gh secret set DOCKERHUB_TOKEN --repo PloinkyRepos/webmeetInfra
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

```sh
gh variable set SSH_USER --repo PloinkyRepos/AssistOSExplorer --body admin
gh variable set SSH_HOST --repo PloinkyRepos/AssistOSExplorer --body 193.180.209.191
gh variable set EXPLORER_WORKSPACE --repo PloinkyRepos/AssistOSExplorer --body explorerWorkspace
gh variable set EXPLORER_ROUTER_PORT --repo PloinkyRepos/AssistOSExplorer --body 8097
gh variable set EXPLORER_PUBLIC_URL --repo PloinkyRepos/AssistOSExplorer --body https://skills.axiologic.dev
gh variable set PLOINKY_PROFILE --repo PloinkyRepos/AssistOSExplorer --body prod
gh variable set ONLYOFFICE_PUBLIC_URL --repo PloinkyRepos/AssistOSExplorer --body https://office.axiologic.dev
gh variable set ONLYOFFICE_INTERNAL_URL --repo PloinkyRepos/AssistOSExplorer --body http://127.0.0.1:8082
gh variable set ONLYOFFICE_CALLBACK_BASE_URL --repo PloinkyRepos/AssistOSExplorer --body https://skills.axiologic.dev
gh variable set WEBMEET_PUBLIC_LIVEKIT_URL --repo PloinkyRepos/AssistOSExplorer --body wss://livekit-skills.axiologic.dev
gh variable set WEBMEET_LIVEKIT_URL --repo PloinkyRepos/AssistOSExplorer --body http://host.containers.internal:7880
gh variable set WEBMEET_EGRESS_URL --repo PloinkyRepos/AssistOSExplorer --body http://host.containers.internal:7980
gh variable set WEBMEET_INFRA_IMAGE_TAG --repo PloinkyRepos/AssistOSExplorer --body webmeet-infra
gh variable set WEBMEET_LIVEKIT_USE_EXTERNAL_IP --repo PloinkyRepos/AssistOSExplorer --body false
gh variable set WEBMEET_LIVEKIT_NODE_IP --repo PloinkyRepos/AssistOSExplorer --body 193.180.209.191
gh variable set WEBMEET_LIVEKIT_UPSTREAM --repo PloinkyRepos/AssistOSExplorer --body http://127.0.0.1:7880
gh variable set WEBMEET_TLS_HOSTNAME --repo PloinkyRepos/AssistOSExplorer --body livekit-skills.axiologic.dev
gh variable set WEBMEET_CERT_EMAIL --repo PloinkyRepos/AssistOSExplorer --body research@axiologic.net
gh variable set WEBMEET_CERTBOT_AUTO_ISSUE --repo PloinkyRepos/AssistOSExplorer --body true
gh variable set WEBMEET_TURN_HOST --repo PloinkyRepos/AssistOSExplorer --body livekit-skills.axiologic.dev
gh variable set WEBMEET_TURN_REALM --repo PloinkyRepos/AssistOSExplorer --body skills.axiologic.dev
gh variable set WEBMEET_TURN_USER --repo PloinkyRepos/AssistOSExplorer --body webmeet
gh variable set WEBMEET_TURN_MIN_PORT --repo PloinkyRepos/AssistOSExplorer --body 20000
gh variable set WEBMEET_TURN_MAX_PORT --repo PloinkyRepos/AssistOSExplorer --body 20010
```

The deploy workflow does not synthesize local LLM defaults when `SOUL_GATEWAY_API_KEY` is supplied; production should use the remote Soul Gateway at `soul.axiologic.dev`. The default embedded Soul Gateway local provider points at the RAAS LM Studio proxy and registers only the known preloaded model. Override these only when deploying without `SOUL_GATEWAY_API_KEY` or when intentionally bootstrapping an embedded local provider:

```sh
gh variable set LOCAL_LLM_BASE_URL --repo PloinkyRepos/AssistOSExplorer --body https://lmstudio.axiologic.dev/v1
gh variable set LOCAL_LLM_MODEL --repo PloinkyRepos/AssistOSExplorer --body gemma-3-12b-it
gh variable set LOCAL_LLM_DISCOVERY_MODE --repo PloinkyRepos/AssistOSExplorer --body single
```

`LOCAL_LLM_DISCOVERY_MODE=single` avoids exposing LM Studio models that are installed but not currently loaded. Use `auto` only for endpoints that can reliably serve every model returned by `/models`. In standalone production mode, agents receive the explicit `SOUL_GATEWAY_API_KEY` and keep the remote Soul Gateway URL; upstream local-provider tokens are not required.

For manual scratch deployments that use the default RAAS LM Studio endpoint, set the upstream token through Ploinky before starting Explorer:

```sh
ploinky var LOCAL_LLM_API_KEY "$LMSTUDIO_PROXY_TOKEN"
```

For embedded Explorer helper agents, leave `SOUL_GATEWAY_API_KEY` unset when you want the workspace-local Soul Gateway. If `SOUL_GATEWAY_API_KEY` is supplied, Achilles treats it as an explicit standalone credential and uses the `LLMConfig.json` Soul Gateway URL unless `SOUL_GATEWAY_BASE_URL` / `SOUL_GATEWAY_URL` is also supplied.

Set `WEBMEET_TURN_EXTERNAL_IP` only when coturn must use an explicit public IP instead of resolving `WEBMEET_TURN_HOST` at startup.

## Provision Host

Run `Provision Skills Explorer Host` only when the remote host needs OS packages, Node.js, Podman, Ploinky, or `achillesAgentLib` installed or refreshed.

## Deploy Or Update

Before deploying production changes that alter `webmeetInfra/liveKitServerAgent`, publish the image from the `PloinkyRepos/webmeetInfra` repository:

```sh
gh workflow run publish-livekit-server-agent.yml \
  --repo PloinkyRepos/webmeetInfra \
  -f image_tag=webmeet-infra
```

Run the `Deploy Skills Explorer` workflow for normal updates:

Normal production deploys can omit `achilles_branch`; the workflow defaults `achillesAgentLib` to `master` because that repository does not publish a `main` branch.

```sh
gh workflow run deploy-skills-explorer.yml \
  --repo PloinkyRepos/AssistOSExplorer \
  -f branch=main \
  -f workspace_name=explorerWorkspace \
  -f router_port=8097 \
  -f public_url=https://skills.axiologic.dev \
  -f profile=prod \
  -f webmeet_infra_image_tag=webmeet-infra

# Feature-branch deploy (all repos on same branch):
gh workflow run deploy-skills-explorer.yml \
  --repo PloinkyRepos/AssistOSExplorer \
  --ref embedded-soul-gateway \
  -f branch=embedded-soul-gateway \
  -f proxies_branch=embedded-soul-gateway \
  -f ploinky_branch=embedded-soul-gateway \
  -f achilles_branch=embedded-soul-gateway
```

The workflow:

1. Connects to `SSH_USER@SSH_HOST` with `SSH_KEY`.
2. Resolves the installed `ploinky` binary and verifies required host tools are already present.
3. Stops the current workspace if it is running.
4. Puts the Ploinky runtime checkout on `ploinky_branch` and `achillesAgentLib` on `achilles_branch`.
5. Adds/enables the `AchillesIDE` and `webmeetInfra` repos through Ploinky commands.
6. Runs `ploinky update` so Ploinky updates the workspace repos and local Ploinky dependencies.
7. Hard-resets the remote Ploinky-managed repo checkouts to the requested branches.
8. Removes retired split WebMeet infra registrations and containers before the unified agent starts.
9. Stores configured runtime variable overrides through `ploinky var`.
10. Pulls `docker.io/assistos/livekit-server-agent:${WEBMEET_INFRA_IMAGE_TAG}`.
11. Starts `AchillesIDE/explorer` on `EXPLORER_ROUTER_PORT` with branch-aware flags (`--branch`, `--repo-branch`, `--branch-fallback fail`, `--reset-repos`).
12. Verifies local router health, `liveKitServerAgent` health on `127.0.0.1:${WEBMEET_INFRA_HEALTH_PORT:-17000}`, OnlyOffice `api.js` through `ONLYOFFICE_INTERNAL_URL`, public `EXPLORER_PUBLIC_URL` access through the Cloudflare tunnel, public `WEBMEET_PUBLIC_LIVEKIT_URL`, and browser-visible OnlyOffice `api.js` when `ONLYOFFICE_PUBLIC_URL` is configured.
