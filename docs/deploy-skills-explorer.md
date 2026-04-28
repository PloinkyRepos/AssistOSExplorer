# Deploy Skills Explorer

This document describes the GitHub Actions deployment for the Explorer agent on `skills.axiologic.dev`.

## GitHub Secrets

Create or update these repository secrets in `PloinkyRepos/AssistOSExplorer`.

```sh
gh secret set SSH_KEY --repo PloinkyRepos/AssistOSExplorer < ~/.ssh/skills-explorer-deploy
gh secret set PLOINKY_MASTER_KEY --repo PloinkyRepos/AssistOSExplorer --body "$(openssl rand -hex 32)"
gh secret set OPENAI_API_KEY --repo PloinkyRepos/AssistOSExplorer
gh secret set OPENROUTER_API_KEY --repo PloinkyRepos/AssistOSExplorer
gh secret set AXIOLOGIC_API_KEY --repo PloinkyRepos/AssistOSExplorer
gh secret set OPENAI_OPENCODE_KEY --repo PloinkyRepos/AssistOSExplorer
gh secret set SOUL_GATEWAY_API_KEY --repo PloinkyRepos/AssistOSExplorer
gh secret set ONLYOFFICE_JWT_SECRET --repo PloinkyRepos/AssistOSExplorer
```

`PLOINKY_MASTER_KEY` must be exactly 64 hex characters. Keep it stable after the first deployment because it encrypts the Ploinky workspace secret stores and local-auth password store.

## Public Access (Cloudflare Tunnel)

`skills.axiologic.dev` is fronted by a Cloudflare Zero Trust tunnel running as a podman container on the host. The tunnel terminates TLS at Cloudflare's edge and forwards directly to the Explorer router on `127.0.0.1:${EXPLORER_ROUTER_PORT}` (default `8097`). The workflow does **not** manage the tunnel; ingress is configured in the Cloudflare Zero Trust dashboard. To change the routing target, edit the tunnel's public hostname configuration in the dashboard rather than touching the workflow.

## GitHub Variables

Create or update these repository variables.

```sh
gh variable set SSH_USER --repo PloinkyRepos/AssistOSExplorer --body admin
gh variable set SSH_HOST --repo PloinkyRepos/AssistOSExplorer --body 193.180.209.191
gh variable set EXPLORER_WORKSPACE --repo PloinkyRepos/AssistOSExplorer --body explorerWorkspace
gh variable set EXPLORER_ROUTER_PORT --repo PloinkyRepos/AssistOSExplorer --body 8097
gh variable set EXPLORER_PUBLIC_URL --repo PloinkyRepos/AssistOSExplorer --body https://skills.axiologic.dev
gh variable set ONLYOFFICE_PUBLIC_URL --repo PloinkyRepos/AssistOSExplorer --body https://office.axiologic.dev
gh variable set ONLYOFFICE_INTERNAL_URL --repo PloinkyRepos/AssistOSExplorer --body http://127.0.0.1:8082
gh variable set ONLYOFFICE_CALLBACK_BASE_URL --repo PloinkyRepos/AssistOSExplorer --body https://skills.axiologic.dev
```

The LLM provider URL and model variables are optional for booting Explorer, but should be present when the deployed agents need model access:

```sh
gh variable set OPENAI_AXIOLOGIC_KIRO_URL --repo PloinkyRepos/AssistOSExplorer --body https://kiro.axiologic.dev/v1/chat/completions
gh variable set OPENAI_AXIOLOGIC_KIRO_KEY_ENV --repo PloinkyRepos/AssistOSExplorer --body AXIOLOGIC_API_KEY
gh variable set ANTHROPIC_AXIOLOGIC_ANTIGRAVITY_URL --repo PloinkyRepos/AssistOSExplorer --body https://antigravity.axiologic.dev/v1/messages
gh variable set ANTHROPIC_AXIOLOGIC_ANTIGRAVITY_KEY_ENV --repo PloinkyRepos/AssistOSExplorer --body AXIOLOGIC_API_KEY
gh variable set OPENAI_OPENCODE_URL --repo PloinkyRepos/AssistOSExplorer --body https://opencode.ai/zen/v1/chat/completions
gh variable set OPENAI_OPENAI_RESPONSES_URL --repo PloinkyRepos/AssistOSExplorer --body https://api.openai.com/v1/responses
gh variable set OPENAI_OPENAI_RESPONSES_KEY_ENV --repo PloinkyRepos/AssistOSExplorer --body OPENAI_API_KEY
gh variable set LLM_MODELS --repo PloinkyRepos/AssistOSExplorer --body '<semicolon-separated model definitions>'
```

## Deploy Or Update

Run the `Deploy Skills Explorer` workflow from GitHub Actions. The same workflow is safe for fresh deploys and updates:

```sh
gh workflow run deploy-skills-explorer.yml \
  --repo PloinkyRepos/AssistOSExplorer \
  -f branch=main \
  -f workspace_name=explorerWorkspace \
  -f router_port=8097 \
  -f public_url=https://skills.axiologic.dev \
  -f update_ploinky=true \
  -f clean_stale_containers=true
```

The workflow:

1. Connects to `SSH_USER@SSH_HOST` with `SSH_KEY`.
2. Installs host prerequisites: Podman, Node.js, Ploinky.
3. Writes `PLOINKY_MASTER_KEY` to the remote workspace `.env` with `0600` permissions.
4. Adds and updates the `fileExplorer` and `webmeetInfra` Ploinky repos.
5. Resets the Ploinky enabled-agent registry to avoid stale ambiguous repos from older deployments.
6. Stores runtime variables through `ploinky var`.
7. Starts `fileExplorer/explorer` on `EXPLORER_ROUTER_PORT`.
8. Verifies local router health and public `EXPLORER_PUBLIC_URL` access (the latter goes through the Cloudflare tunnel).

