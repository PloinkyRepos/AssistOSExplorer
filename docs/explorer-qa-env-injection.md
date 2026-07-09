# Explorer QA Environment Injection

Last updated: 2026-07-09

This document narrows the broader Explorer environment audit to the values that
are mandatory and user-provided for the QA deployment workflow, then traces how
`deploy-explorer-qa.yml` injects those values into Ploinky or the agents that
need them.

## Mandatory User-Provided Values

| Value in GitHub | Runtime/workflow env | Why it is mandatory | Injection path | Final consumer | Status |
| --- | --- | --- | --- | --- | --- |
| `secrets.EXPLORER_QA_SSH_KEY` | `SSH_KEY` and `~/.ssh/deploy_key` | Required to reach the QA host | Validated by the workflow, written to `~/.ssh/deploy_key`, used by `scp` and `ssh` | GitHub runner only | Implemented |
| `secrets.EXPLORER_QA_PLOINKY_MASTER_KEY` | `PLOINKY_MASTER_KEY` | Required to decrypt and write the QA workspace Ploinky secret store; must be stable 64 hex chars | Validated, copied through `/tmp/explorer_qa_env`, sourced remotely, passed as `env PLOINKY_MASTER_KEY=...` to `ploinky shutdown`, `update`, `var`, `start`, `echo`, and `status` | Ploinky CLI/runtime only | Implemented |
| `vars.EXPLORER_QA_WEB_PUBLISHING_BASE_DOMAIN` | `WEB_PUBLISHING_BASE_DOMAIN` | Required to generate Explorer, OnlyOffice, and LiveKit public hostnames | Validated, copied through `/tmp/explorer_qa_env`, persisted with `ploinky var WEB_PUBLISHING_BASE_DOMAIN "$value"` | `basic/web-publishing` provider | Implemented |
| `secrets.EXPLORER_QA_WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN` | `WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN` | Required when the Web Publishing mode uses token-mode Cloudflare Tunnel startup | Validated for `token`, `cloudflare-token`, and `nginx-cloudflare`, copied through `/tmp/explorer_qa_env`, persisted with `ploinky var` | `basic/web-publishing` manifest maps it to container env `TUNNEL_TOKEN` | Implemented |

## Workflow Injection Path

| Step | Workflow behavior | File evidence |
| --- | --- | --- |
| Validate GitHub config | Checks `EXPLORER_QA_SSH_KEY`, `EXPLORER_QA_PLOINKY_MASTER_KEY`, `EXPLORER_QA_WEB_PUBLISHING_BASE_DOMAIN`, and token presence when token-mode Web Publishing is selected. The master key must match `^[A-Fa-f0-9]{64}$`. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Build remote env file | Writes `PLOINKY_MASTER_KEY`, `WEB_PUBLISHING_*` inputs, WebMeet media/runtime values, image tags, and infra check settings to `/tmp/explorer_qa_env`. Blank optional values are omitted, except `PLOINKY_MASTER_KEY`. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Copy and source on remote host | Copies `/tmp/explorer_qa_env` to the QA host, then `set -a; . /tmp/explorer_qa_env; set +a` so values become shell env for the remote deploy script. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Install and reset repos | Installs `AchillesIDE`, `basic`, `webmeetInfra`, and `proxies`, then resets each to the requested branch. `basic_branch` controls the `basic` checkout and is forwarded to `ploinky start` through `--repo-branch basic=...`. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Clear stale public topology vars | Deletes old direct OnlyOffice/WebMeet public topology vars from the encrypted Ploinky workspace var store before new provider values are generated. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Persist workspace vars | Calls `env PLOINKY_MASTER_KEY="$PLOINKY_MASTER_KEY" "$PLOINKY" var "$name" "$value"` through `set_var`. This writes encrypted workspace variables into the QA Ploinky workspace. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Start Explorer | Runs `env PLOINKY_MASTER_KEY="$PLOINKY_MASTER_KEY" "$PLOINKY" start AchillesIDE/explorer "$ROUTER_PORT" ...`. Ploinky starts `basic/web-publishing`, runs its startup config provider, writes public topology values, and then resolves dependent agent env. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Verify provider outputs | Reads `ONLYOFFICE_PUBLIC_URL`, `ONLYOFFICE_INTERNAL_URL`, and `WEBMEET_PUBLIC_LIVEKIT_URL` with `ploinky echo` after startup. Public verification uses those generated values, not repository variables. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |

## Current Implemented Mappings

| Ploinky workspace var | Source in workflow | Agent/provider consumer | Notes |
| --- | --- | --- | --- |
| `ASSISTOS_FS_ROOT` | Remote `WORK_DIR` | Explorer, DPU-adjacent file access | Set directly with `ploinky var`. |
| `WORKSPACE_ROOT` | Remote `WORK_DIR` | WebMeet and other workspace-aware agents | Set directly with `ploinky var`. |
| `PLOINKY_WORKSPACE_ROOT` | Remote `WORK_DIR` | Runtime and workspace discovery | Also exported before Ploinky commands so CLI workspace resolution stays pinned. |
| `WEB_PUBLISHING_MODE` | Repo var or `nginx-cloudflare` | `basic/web-publishing` | Controls nginx-only, token tunnel, combined nginx/tunnel, or API planning modes. |
| `WEB_PUBLISHING_BASE_DOMAIN` | `vars.EXPLORER_QA_WEB_PUBLISHING_BASE_DOMAIN` | `basic/web-publishing` | Required by the QA workflow so provider-generated hostnames are deterministic. |
| `WEB_PUBLISHING_PUBLIC_URL` | `vars.EXPLORER_QA_WEB_PUBLISHING_PUBLIC_URL`, workflow `public_url`, or `vars.EXPLORER_QA_PUBLIC_URL` | `basic/web-publishing` | Optional Explorer callback/public URL override. |
| `WEB_PUBLISHING_PUBLIC_HOST` | Repo var | `basic/web-publishing` | Optional explicit public host/IP used by provider outputs such as TURN external IP. |
| `WEB_PUBLISHING_CERT_EMAIL` | Repo var | `basic/web-publishing` | Optional cert email used when generating `WEBMEET_CERT_EMAIL` for dependent WebMeet infra. |
| `WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN` | Scoped GitHub secret | `basic/web-publishing` | Required only for token-mode tunnel startup. The value is stored encrypted and passed to the container as `TUNNEL_TOKEN`. |
| `WEB_PUBLISHING_CLOUDFLARE_API_TOKEN` | Scoped GitHub secret | Web Publishing admin/API tools | Optional for DNS/tunnel apply operations. |
| `WEB_PUBLISHING_CLOUDFLARE_ACCOUNT_ID`, `WEB_PUBLISHING_CLOUDFLARE_ZONE_ID`, `WEB_PUBLISHING_CLOUDFLARE_TUNNEL_ID`, `WEB_PUBLISHING_CLOUDFLARE_TUNNEL_NAME` | Repo vars | Web Publishing admin/API tools | Optional Cloudflare identifiers for planning and applying tunnel/DNS changes. |
| `WEBMEET_EGRESS_URL` | Repo var or prod fallback | WebMeet recording/infra paths | In `prod`, defaults to `http://host.containers.internal:7980` if empty. |
| `WEBMEET_INFRA_IMAGE_TAG` | Workflow input, repo var, or `webmeet-infra` | Image pull and infra startup | Optional deployment override. |
| `PLOINKY_NODE_IMAGE_TAG` | Workflow input, repo var, or `24-bookworm-tools` | Image pull | Optional deployment override. |
| `WEBMEET_INFRA_HEALTH_PORT` | Repo var or `17000` | `liveKitServerAgent` health check | Optional/defaulted. |
| `WEBMEET_LIVEKIT_USE_EXTERNAL_IP`, `WEBMEET_LIVEKIT_NODE_IP`, `WEBMEET_LIVEKIT_LOG_LEVEL`, `WEBMEET_LIVEKIT_FORCE_TCP`, `WEBMEET_LIVEKIT_REDIS_ADDRESS`, `WEBMEET_EGRESS_REDIS_ADDRESS`, `WEBMEET_LIVEKIT_INTERNAL_WS_URL` | Repo vars | `liveKitServerAgent` | Optional media/runtime overrides. |
| `WEBMEET_TLS_HTTPS_PORT`, `WEBMEET_TLS_HTTP_PORT`, `WEBMEET_CERTBOT_AUTO_ISSUE`, `WEBMEET_CERTBOT_RENEW_INTERVAL_SECONDS` | Repo vars | `liveKitServerAgent` | Optional TLS/certbot runtime controls. Hostname and cert email come from Web Publishing output. |
| `WEBMEET_TURN_PORT`, `WEBMEET_TURN_USER`, `WEBMEET_ICE_TRANSPORT_POLICY`, `WEBMEET_TURN_MIN_PORT`, `WEBMEET_TURN_MAX_PORT` | Repo vars or workflow fallback | `liveKitServerAgent` and `webmeetAgent` | Optional media/TURN controls. TURN host, realm, and external IP come from Web Publishing output. |

## Web Publishing Output Path

The QA workflow defaults `PLOINKY_PROFILE` to `prod`, so Explorer `prod` enables
`basic/web-publishing` as a blocking dependency and lists it under
`configProviders`. Ploinky resolves the dependency graph, starts the provider,
runs `node runtime/provider.mjs`, validates the provider output against the
Web Publishing manifest, and writes accepted values into `.ploinky/.secrets`
before dependent agent env maps are built.

The provider emits public topology values derived from
`WEB_PUBLISHING_BASE_DOMAIN` and optional saved Web Publishing settings. Those
values intentionally replace old direct workflow mappings for OnlyOffice and
WebMeet public URLs/hostnames.

| Generated public value | Default generated shape for `example.com` | Main consumer |
| --- | --- | --- |
| `ONLYOFFICE_PUBLIC_URL` | `https://office.example.com` | Browser editor script loading. |
| `ONLYOFFICE_INTERNAL_URL` | `http://host.containers.internal:8082` | Server-side health checks and internal callbacks. |
| `ONLYOFFICE_CALLBACK_BASE_URL` | `https://explorer.example.com` | Browser/editor callback base. |
| `WEBMEET_PUBLIC_LIVEKIT_URL` | `wss://meet.example.com` | Browser LiveKit signaling URL in join payloads. |
| `WEBMEET_LIVEKIT_URL` | `http://host.containers.internal:7880` | Server-side LiveKit API URL used by `webmeetAgent`. |
| `WEBMEET_TLS_HOSTNAME` | `meet.example.com` | LiveKit nginx/certbot hostname. |
| `WEBMEET_TURN_HOST` | `meet.example.com` | Browser and infra TURN hostname. |
| `WEBMEET_TURN_REALM` | `meet.example.com` | Coturn realm. |

## Values Deliberately Not Required From Users

| Values | Why not user-provided |
| --- | --- |
| Direct OnlyOffice public URLs and callback URLs | Web Publishing owns and publishes those values for managed QA/prod. |
| Direct WebMeet public signaling, TLS hostname, TURN host, TURN realm, and public media host values | Web Publishing owns public topology. WebMeet-specific workflow vars remain only for media/runtime controls. |
| `ONLYOFFICE_JWT_SECRET`, `JWT_SECRET` | Shared generated secrets in Explorer and `onlyOffice` manifests. |
| `WEBMEET_LIVEKIT_API_KEY`, `WEBMEET_LIVEKIT_API_SECRET`, `WEBMEET_TURN_PASSWORD`, `PLOINKY_WEBMEET_MASTER_KEY` | Generated/shared-generated WebMeet credentials. |
| `PLOINKY_AGENT_ID`, `PLOINKY_AGENT_SECRET`, `PLOINKY_AGENT_PRINCIPAL`, `PLOINKY_AGENT_API_KEY`, `PLOINKY_AGENT_API_PUBLIC_KEY` | Ploinky-injected identity and signed subject credentials. |
| `DPU_MASTER_KEY` | Generated DPU data-encryption secret. |
| External LLM/search provider keys | Not mandatory for this QA workflow unless a specific external provider path is intentionally enabled. |
