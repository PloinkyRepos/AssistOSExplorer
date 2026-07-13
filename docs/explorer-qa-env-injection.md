# Explorer QA Environment Injection

Last updated: 2026-07-12

This document narrows the broader Explorer environment audit to the values that
are mandatory and user-provided for the QA deployment workflow, then traces how
`deploy-explorer-qa.yml` injects those values into Ploinky or the agents that
need them.

## Mandatory User-Provided Values

| Value in GitHub | Runtime/workflow env | Why it is mandatory | Injection path | Final consumer | Status |
| --- | --- | --- | --- | --- | --- |
| `secrets.EXPLORER_QA_SSH_KEY` | `SSH_KEY` and `~/.ssh/deploy_key` | Required to reach the QA host | Validated by the workflow, written to `~/.ssh/deploy_key`, used by `scp` and `ssh` | GitHub runner only | Implemented |
| `secrets.EXPLORER_QA_PLOINKY_MASTER_KEY` | `PLOINKY_MASTER_KEY` | Required to decrypt and write the QA workspace Ploinky secret store; must be stable 64 hex chars | Validated, copied through `/tmp/explorer_qa_env`, sourced remotely, passed as `env PLOINKY_MASTER_KEY=...` to `ploinky shutdown`, `update`, `var`, `start`, `echo`, and `status` | Ploinky CLI/runtime only | Implemented |
| `vars.EXPLORER_QA_WEB_PUBLISHING_BASE_DOMAIN` | `WEB_PUBLISHING_BASE_DOMAIN` | Required to generate Explorer, OnlyOffice, and LiveKit public hostnames | Validated as a canonical lowercase DNS domain, copied through `/tmp/explorer_qa_env`, persisted with `ploinky var WEB_PUBLISHING_BASE_DOMAIN "$value"` | `basic/web-publishing` provider | Implemented |
| `vars.EXPLORER_QA_WEB_PUBLISHING_TLS_EDGE` | `WEB_PUBLISHING_TLS_EDGE` | Required to declare the trusted signaling terminator; use `cloudflare` or `external` | Validated, copied through `/tmp/explorer_qa_env`, persisted with `ploinky var` | `basic/web-publishing` provider | Implemented |
| `vars.EXPLORER_QA_WEB_PUBLISHING_LIVEKIT_MEDIA_IP` | `WEB_PUBLISHING_LIVEKIT_MEDIA_IP` | Required public IPv4 address for direct LiveKit media | Validated as a bare unicast, non-loopback IPv4 address, copied through `/tmp/explorer_qa_env`, persisted with `ploinky var` | Web Publishing provider, then `liveKitServerAgent` | Implemented |
| `vars.EXPLORER_QA_WEB_PUBLISHING_TURN_EXTERNAL_IP` | `WEB_PUBLISHING_TURN_EXTERNAL_IP` | Required public IPv4 address for the DNS-only TURN endpoint | Validated as a bare unicast, non-loopback IPv4 address, copied through `/tmp/explorer_qa_env`, persisted with `ploinky var` | Web Publishing provider, then `turnServerAgent` | Implemented |
| `secrets.EXPLORER_QA_WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN` | `WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN` | Required when the Web Publishing mode uses token-mode Cloudflare Tunnel startup | Validated for `token`, `cloudflare-token`, and `nginx-cloudflare`, copied through `/tmp/explorer_qa_env`, persisted with `ploinky var` | `basic/web-publishing` manifest maps it to container env `TUNNEL_TOKEN` | Implemented |
| Remote `$HOME/$WORKSPACE/.ploinky/data/webmeetTls/turn/{fullchain,privkey}.pem` | Operator-provisioned TURN TLS material | Required before the public TURN/TLS listener can start | Validated remotely before shutdown, repository updates, image pulls, or agent startup; never created or replaced by the workflow | `turnServerAgent` read-only TLS mount | Implemented |
| DNS-only `turn.<WEB_PUBLISHING_BASE_DOMAIN>` A record with no AAAA record | Operator-provisioned public DNS | Required before every accepted managed public deployment; every A record must equal `WEB_PUBLISHING_TURN_EXTERNAL_IP`, and the IPv4-only hostname must resolve no IPv6 addresses | Queried remotely with `dns.resolve4` and `dns.resolve6` before shutdown or repository/start work; an unexpected AAAA lookup error fails closed | Public TURN clients | Implemented |

## Workflow Injection Path

| Step | Workflow behavior | File evidence |
| --- | --- | --- |
| Validate GitHub config | Checks `EXPLORER_QA_SSH_KEY`, `EXPLORER_QA_PLOINKY_MASTER_KEY`, a canonical lowercase DNS base domain, bare unicast/non-loopback LiveKit media and TURN IPv4 inputs, TLS edge, and token presence when token-mode Web Publishing is selected. The master key must match `^[A-Fa-f0-9]{64}$`. `cloudflare-api` is rejected because this workflow never applies external Cloudflare mutations. `nginx` requires the `external` TLS edge; accepted token modes require `cloudflare`. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Build remote env file | Writes `PLOINKY_MASTER_KEY`, supported `WEB_PUBLISHING_*` inputs, supported WebMeet runtime values, the Ploinky Node image tag, and the OnlyOffice infra-check setting to `/tmp/explorer_qa_env`. Blank optional values are omitted, except `PLOINKY_MASTER_KEY`. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Copy and source on remote host | Copies `/tmp/explorer_qa_env` to the QA host, then `set -a; . /tmp/explorer_qa_env; set +a` so values become shell env for the remote deploy script. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Preflight TURN endpoint | Requires readable, regular, non-symlink `fullchain.pem` and `privkey.pem`; rejects expired/wrong-host/mismatched TLS material. Every accepted public mode also requires `turn.<base-domain>` to resolve only to the configured TURN external IPv4 and to have no AAAA record before any shutdown, repository operation, image pull, or start. An unexpected IPv6 DNS lookup error fails closed. DNS cannot prove Cloudflare proxy status, so the operator must confirm DNS-only configuration separately. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Install and reset repos | Installs `AchillesIDE`, `basic`, `webmeetInfra`, and `proxies`, then resets each to the requested branch. `branch`, `basic_branch`, and `webmeet_infra_branch` default to `ploinky-box` and are forwarded through matching `--repo-branch` arguments. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Clear stale public topology vars | Deletes old direct OnlyOffice/WebMeet public topology vars from the encrypted Ploinky workspace var store before new provider values are generated. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Persist workspace vars | Calls `env PLOINKY_MASTER_KEY="$PLOINKY_MASTER_KEY" "$PLOINKY" var "$name" "$value"` through `set_var`. This writes encrypted workspace variables into the QA Ploinky workspace. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Start Explorer | Runs `env PLOINKY_MASTER_KEY="$PLOINKY_MASTER_KEY" "$PLOINKY" start AchillesIDE/explorer "$ROUTER_PORT" ...`. Ploinky starts `basic/web-publishing`, runs its startup config provider, writes public topology values, and then resolves dependent agent env. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |
| Verify provider outputs | Reads `ONLYOFFICE_PUBLIC_URL`, `ONLYOFFICE_INTERNAL_URL`, and `WEBMEET_PUBLIC_LIVEKIT_URL` with `ploinky echo` after startup. Signaling must equal exactly `wss://meet.<WEB_PUBLISHING_BASE_DOMAIN>`; a missing, altered-host, or downgraded-scheme value fails. The runner probes the canonical HTTPS hostname with a bounded, bodyless HTTP/1.1 WebSocket-upgrade request on exact `/rtc` and requires the expected unauthenticated `401`. Public verification uses generated values, not repository variables. | [`.github/workflows/deploy-explorer-qa.yml`](../.github/workflows/deploy-explorer-qa.yml) |

## Current Implemented Mappings

| Ploinky workspace var | Source in workflow | Agent/provider consumer | Notes |
| --- | --- | --- | --- |
| `ASSISTOS_FS_ROOT` | Remote `WORK_DIR` | Explorer, DPU-adjacent file access | Set directly with `ploinky var`. |
| `WORKSPACE_ROOT` | Remote `WORK_DIR` | WebMeet and other workspace-aware agents | Set directly with `ploinky var`. |
| `PLOINKY_WORKSPACE_ROOT` | Remote `WORK_DIR` | Runtime and workspace discovery | Also exported before Ploinky commands so CLI workspace resolution stays pinned. |
| `WEB_PUBLISHING_MODE` | Repo var or `nginx-cloudflare` | `basic/web-publishing` | Managed QA accepts nginx-only, token tunnel, or combined nginx/tunnel modes. It rejects `cloudflare-api`; tunnel and DNS changes must be pre-provisioned outside this workflow. `nginx` pairs only with `external`; token modes pair only with `cloudflare`. |
| `WEB_PUBLISHING_BASE_DOMAIN` | `vars.EXPLORER_QA_WEB_PUBLISHING_BASE_DOMAIN` | `basic/web-publishing` | Required as a canonical lowercase DNS domain so provider-generated hostnames are deterministic. |
| `WEB_PUBLISHING_PUBLIC_URL` | `vars.EXPLORER_QA_WEB_PUBLISHING_PUBLIC_URL`, workflow `public_url`, or `vars.EXPLORER_QA_PUBLIC_URL` | `basic/web-publishing` | Optional Explorer callback/public URL override. |
| `WEB_PUBLISHING_TLS_EDGE` | `vars.EXPLORER_QA_WEB_PUBLISHING_TLS_EDGE` | `basic/web-publishing` | Required explicit edge contract: `cloudflare` for Cloudflare termination or `external` for a separately managed trusted terminator. |
| `WEB_PUBLISHING_LIVEKIT_MEDIA_IP` | `vars.EXPLORER_QA_WEB_PUBLISHING_LIVEKIT_MEDIA_IP` | Web Publishing and `liveKitServerAgent` | Required as a bare unicast/non-loopback IPv4 direct media address; kept separate from signaling. |
| `WEB_PUBLISHING_TURN_EXTERNAL_IP` | `vars.EXPLORER_QA_WEB_PUBLISHING_TURN_EXTERNAL_IP` | Web Publishing and `turnServerAgent` | Required as a bare unicast/non-loopback IPv4 DNS-only TURN relay address; kept separate from signaling. |
| `WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN` | Scoped GitHub secret | `basic/web-publishing` | Required only for token-mode tunnel startup. The value is stored encrypted and passed to the container as `TUNNEL_TOKEN`. |
| `WEB_PUBLISHING_CLOUDFLARE_API_TOKEN` | Scoped GitHub secret | Web Publishing admin/API tools | Optional for separately invoked DNS/tunnel operations; the managed QA workflow never applies them. |
| `WEB_PUBLISHING_CLOUDFLARE_ACCOUNT_ID`, `WEB_PUBLISHING_CLOUDFLARE_ZONE_ID`, `WEB_PUBLISHING_CLOUDFLARE_TUNNEL_ID`, `WEB_PUBLISHING_CLOUDFLARE_TUNNEL_NAME` | Repo vars | Web Publishing admin/API tools | Optional identifiers for separately invoked planning/apply tools; they do not make API mode valid in this workflow. |
| `PLOINKY_NODE_IMAGE_TAG` | Workflow input, repo var, or `24-bookworm-tools` | Image pull | Optional deployment override. |
| `WEBMEET_LIVEKIT_LOG_LEVEL`, `WEBMEET_LIVEKIT_FORCE_TCP`, `WEBMEET_LIVEKIT_REDIS_ADDRESS`, `WEBMEET_EGRESS_REDIS_ADDRESS`, `WEBMEET_LIVEKIT_INTERNAL_WS_URL` | Repo vars | `liveKitServerAgent` | Optional private runtime tuning. Public media IP comes only from Web Publishing. |
| `WEBMEET_ICE_TRANSPORT_POLICY` | Repo var or `all` | `webmeetAgent` | The only WebMeet-agent ICE input; exactly `all` or `relay`, with invalid values rejected. |

## Web Publishing Output Path

The QA workflow may set `PLOINKY_PROFILE` to `prod` for deployment defaults, but
Explorer itself declares only the `default` profile. That profile enables
`basic/web-publishing` as a blocking dependency and lists it under
`configProviders`, so local, QA, and production launches all use the same
Explorer profile wiring. Ploinky resolves the dependency graph, starts the
provider, runs `node runtime/provider.mjs`, validates the provider output
against the Web Publishing manifest, and writes accepted values into
`.ploinky/.secrets` before dependent agent env maps are built.

The provider emits public topology values derived from
`WEB_PUBLISHING_BASE_DOMAIN` and optional saved Web Publishing settings. Those
values intentionally replace old direct workflow mappings for OnlyOffice and
WebMeet public URLs/hostnames.

| Generated public value | Default generated shape for `example.com` | Main consumer |
| --- | --- | --- |
| `ONLYOFFICE_PUBLIC_URL` | `https://office.example.com` | Browser editor script loading. |
| `ONLYOFFICE_INTERNAL_URL` | `http://127.0.0.1:80` | OnlyOfficeAgent's co-located Document Server target; this is container loopback, not a sibling or host-gateway route. Web Publishing reaches the editor proxy separately at `http://onlyoffice:8080` on `office-publishing`. |
| `ONLYOFFICE_CALLBACK_BASE_URL` | `https://explorer.example.com` | Browser/editor callback base. |
| `WEBMEET_PUBLIC_LIVEKIT_URL` | `wss://meet.example.com` | Browser LiveKit signaling URL in join payloads. |
| `WEBMEET_LIVEKIT_URL` | `http://livekitserveragent:7880` | Private bridge-network LiveKit API URL used by `webmeetAgent`. |
| `WEBMEET_LIVEKIT_NODE_IP` | Explicit configured IPv4 address | Public candidate address used by LiveKit media. |
| `WEBMEET_TURN_HOST` | `turn.example.com` | DNS-only TURN hostname, separate from `meet.example.com`. |
| `WEBMEET_TURN_EXTERNAL_IP` | Explicit configured IPv4 address | Public TURN relay address. |
| `WEBMEET_TURN_ALLOWED_PEER_IPS` | LiveKit media IPv4 plus `/32` | Exclusive Coturn peer allowlist. |

For Cloudflare termination, the tunnel reaches Web Publishing only through its same-container `127.0.0.1:18081` connector, which requires Cloudflare's overwritten `CF-Connecting-IP`. For an external trusted terminator, the proxy reaches the host-loopback-only `127.0.0.1:18083` connector, preserves the canonical Host header, and validates and overwrites `X-Real-IP`. Neither connector is a general public listener, and raw `8081` is not the public WSS origin in either managed mode.

## Values Deliberately Not Required From Users

| Values | Why not user-provided |
| --- | --- |
| Direct OnlyOffice public URLs and callback URLs | Web Publishing owns and publishes those values for managed QA/prod. |
| Downstream WebMeet signaling, TURN host/peer allowlist, and public media values | Web Publishing owns and publishes these outputs. Coturn derives its realm from the canonical TURN hostname. Users supply only the scoped `WEB_PUBLISHING_TLS_EDGE`, `WEB_PUBLISHING_LIVEKIT_MEDIA_IP`, and `WEB_PUBLISHING_TURN_EXTERNAL_IP` inputs. |
| `ONLYOFFICE_JWT_SECRET`, `JWT_SECRET` | Shared generated secrets in Explorer and `onlyOffice` manifests. |
| `WEBMEET_LIVEKIT_API_KEY`, `WEBMEET_LIVEKIT_API_SECRET`, `WEBMEET_TURN_AUTH_SECRET`, `PLOINKY_WEBMEET_MASTER_KEY` | Generated/shared-generated WebMeet credentials. The TURN secret is consumed only by LiveKit and Coturn. |
| `PLOINKY_AGENT_ID`, `PLOINKY_AGENT_SECRET`, `PLOINKY_AGENT_PRINCIPAL`, `PLOINKY_AGENT_API_KEY`, `PLOINKY_AGENT_API_PUBLIC_KEY` | Ploinky-injected identity and signed subject credentials. |
| `DPU_MASTER_KEY` | Generated DPU data-encryption secret. |
| External LLM/search provider keys | Not mandatory for this QA workflow unless a specific external provider path is intentionally enabled. |
