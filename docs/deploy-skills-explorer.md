# Deploy Skills Explorer

This document describes the GitHub Actions deployment for the Explorer agent on `skills.axiologic.dev`.

## GitHub Secrets

Create or update these repository secrets in `PloinkyRepos/AssistOSExplorer`.

```sh
gh secret set SSH_KEY --repo PloinkyRepos/AssistOSExplorer < ~/.ssh/skills-explorer-deploy
gh secret set PLOINKY_MASTER_KEY --repo PloinkyRepos/AssistOSExplorer --body "$(openssl rand -hex 32)"
gh secret set SOUL_GATEWAY_API_KEY --repo PloinkyRepos/AssistOSExplorer
gh secret set WEBMEET_LIVEKIT_API_SECRET --repo PloinkyRepos/AssistOSExplorer
gh secret set WEBMEET_TURN_PASSWORD --repo PloinkyRepos/AssistOSExplorer
```

`PLOINKY_MASTER_KEY` must be exactly 64 hex characters. Keep it stable after the first deployment because it encrypts the Ploinky workspace secret stores and local-auth password store.
`ONLYOFFICE_JWT_SECRET` is not configured as a GitHub secret for the managed Document Server. Explorer derives `ONLYOFFICE_JWT_SECRET` through its Ploinky manifest, and the `onlyOffice` Ploinky agent derives its container `JWT_SECRET` from the same `AchillesIDE/explorer/ONLYOFFICE_JWT_SECRET` identity. Explorer's host preinstall hook no longer computes or injects the Document Server secret.

## Public Access (Cloudflare Tunnel)

`skills.axiologic.dev` is fronted by a Cloudflare Zero Trust tunnel running as a podman container on the host. The tunnel terminates TLS at Cloudflare's edge and forwards directly to the Explorer router on `127.0.0.1:${EXPLORER_ROUTER_PORT}` (default `8097`). The workflow does **not** manage the tunnel; ingress is configured in the Cloudflare Zero Trust dashboard. To change the routing target, edit the tunnel's public hostname configuration in the dashboard rather than touching the workflow.

## LiveKit Public Access

WebMeet uses a separate public LiveKit endpoint:

```text
wss://livekit-skills.axiologic.dev
```

Current production routing uses a DNS-only A record for `livekit-skills.axiologic.dev` pointing to `193.180.209.191`. TLS is terminated by nginx on the host, and nginx proxies WebSocket/API traffic to LiveKit on `127.0.0.1:7880`. The GitHub workflows do not currently provision or update this nginx/certbot setup.

The optional `webmeetLivekitAiAgent` worker runs on the host network in the `prod` profile so its server-side WebRTC connection uses the same host-network topology as LiveKit. Its manifest supplies a separate `WEBMEET_LIVEKIT_AGENT_URL` default of `http://127.0.0.1:7880`; do not point it at the bridge-only `WEBMEET_LIVEKIT_URL` unless the worker network topology changes too.

If this DNS-only/nginx path remains in use, keep the Let's Encrypt renewal hook aligned with nginx:

```sh
ssh -i ~/demo_private_key.pem admin@193.180.209.191 \
  "printf '%s\n' '#!/bin/sh' 'systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null && sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh && sudo rm -f /etc/letsencrypt/renewal-hooks/deploy/reload-caddy.sh"
```

If `livekit-skills.axiologic.dev` is moved back behind Cloudflare/Tunnel, retest WebMeet before removing nginx/certbot because the final client-side subscription fix has not been A/B tested against the old signaling path.

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
gh variable set WEBMEET_EGRESS_URL --repo PloinkyRepos/AssistOSExplorer --body http://webmeetLivekitEgress:7980
gh variable set WEBMEET_LIVEKIT_USE_EXTERNAL_IP --repo PloinkyRepos/AssistOSExplorer --body false
gh variable set WEBMEET_LIVEKIT_NODE_IP --repo PloinkyRepos/AssistOSExplorer --body 193.180.209.191
gh variable set WEBMEET_TURN_HOST --repo PloinkyRepos/AssistOSExplorer --body livekit-skills.axiologic.dev
gh variable set WEBMEET_TURN_REALM --repo PloinkyRepos/AssistOSExplorer --body skills.axiologic.dev
gh variable set WEBMEET_TURN_USER --repo PloinkyRepos/AssistOSExplorer --body webmeet
gh variable set WEBMEET_TURN_MIN_PORT --repo PloinkyRepos/AssistOSExplorer --body 20000
gh variable set WEBMEET_TURN_MAX_PORT --repo PloinkyRepos/AssistOSExplorer --body 20010
```

Direct provider keys and model lists are intentionally not part of this deployment. Agents that need model access use `SOUL_GATEWAY_API_KEY` and the optional `SOUL_GATEWAY_BASE_URL`.

Set `WEBMEET_TURN_EXTERNAL_IP` only when coturn must use an explicit public IP instead of resolving `WEBMEET_TURN_HOST` at startup.

## Provision Host

Run `Provision Skills Explorer Host` only when the remote host needs OS packages, Node.js, Podman, Ploinky, or `achillesAgentLib` installed or refreshed.

## Deploy Or Update

Run the `Deploy Skills Explorer` workflow for normal updates:

```sh
gh workflow run deploy-skills-explorer.yml \
  --repo PloinkyRepos/AssistOSExplorer \
  -f branch=main \
  -f workspace_name=explorerWorkspace \
  -f router_port=8097 \
  -f public_url=https://skills.axiologic.dev \
  -f profile=prod
```

The workflow:

1. Connects to `SSH_USER@SSH_HOST` with `SSH_KEY`.
2. Resolves the installed `ploinky` binary and verifies required host tools are already present.
3. Stops the current workspace if it is running.
4. Adds/enables the `AchillesIDE` and `webmeetInfra` repos through Ploinky commands.
5. Runs `ploinky update` so Ploinky updates the workspace repos and local Ploinky dependencies.
6. Stores configured runtime variable overrides through `ploinky var`.
7. Starts `AchillesIDE/explorer` on `EXPLORER_ROUTER_PORT`.
8. Verifies local router health, OnlyOffice `api.js` through `ONLYOFFICE_INTERNAL_URL`, public `EXPLORER_PUBLIC_URL` access through the Cloudflare tunnel, and browser-visible OnlyOffice `api.js` when `ONLYOFFICE_PUBLIC_URL` is configured.
