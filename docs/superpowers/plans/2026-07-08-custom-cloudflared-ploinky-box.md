# Custom Cloudflared Ploinky Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom `basic/cloudflared` Ploinky agent image that runs Cloudflare Tunnel inside ploinky-box, exposes admin-only Cloudflare tunnel configuration tools, and surfaces those tools through an Explorer Settings dashboard enabled only for the production profile.

**Architecture:** `basic/cloudflared` owns the tunnel connector and Cloudflare configuration MCP tools. The custom Docker image copies the official Cloudflare `cloudflared` binary from `docker.io/cloudflare/cloudflared:latest` into `docker.io/assistos/ploinky-node:24-bookworm-tools` so the same container can run a tunnel supervisor as the main process and the standard Ploinky AgentServer as a sidecar. `AssistOSExplorer/explorer` enables `basic/cloudflared` only from `profiles.prod.enable` and contributes an admin-only Settings component that calls the cloudflared agent tools through the Ploinky router.

**Tech Stack:** Ploinky manifests and profiles, Node.js 24 ES modules, bundled Ploinky AgentServer MCP runtime, Cloudflare Tunnel `cloudflared`, Cloudflare Tunnel API, Docker Buildx, Explorer runtime plugin Settings components, Node test runner.

---

## Current Branch Scope

| Repo | Branch for this work | Reason |
| --- | --- | --- |
| `/Users/danielsava/work/file-parser/AssistOSExplorer` | `ploinky-box` | Explorer manifest production profile, Settings dashboard plugin, docs/specs/tests. |
| `/Users/danielsava/work/file-parser/basic` | `main` | User explicitly approved using `main` directly for `basic/cloudflared`. |
| `/Users/danielsava/work/file-parser/container-image-builds` | `ploinky-box` | Custom `assistos/cloudflared-agent` image definition and publish workflow. |

`UmamiAgent` is standalone and is not affected. `webmeetInfra`, `proxies`, `AchillesCLI`, and `ploinky` do not need branches for this requirement.

## External Contracts To Preserve

| Contract | Implementation consequence |
| --- | --- |
| Ploinky router remains the public application boundary. | The dashboard calls MCP tools through the router. Do not expose cloudflared tool HTTP endpoints or random agent `7000` ports. |
| Cloudflare Tunnel is outbound-only from the origin. | The tunnel agent does not require inbound host ports. Published app ingress rules point at box-visible origins such as `http://host.containers.internal:8080`. |
| Cloudflare ingress configs require ordered rules and a final catch-all. | Every generated ingress config ends with `{ "service": "http_status:404" }`. |
| LiveKit media is not solved by HTTP tunnel rules. | The UI can expose HTTP/WebSocket control surfaces, but docs must say LiveKit UDP/media still needs explicit `ploinky start explorer --publish ...` or a TURN/media-plane deployment. |
| Official Cloudflare image is distroless with `cloudflared` entrypoint. | Use the Cloudflare image as a build stage and copy `/usr/local/bin/cloudflared` into the Ploinky Node final image. |

Sources checked while preparing this plan: [Cloudflare Tunnel overview](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/), [Cloudflare tunnel configuration file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/), [cloudflare/cloudflared Docker image](https://hub.docker.com/r/cloudflare/cloudflared), and [cloudflare/cloudflared Dockerfile](https://github.com/cloudflare/cloudflared/blob/master/Dockerfile).

## File Structure

| Repo | File | Responsibility |
| --- | --- | --- |
| `container-image-builds` | `images/cloudflared-agent/Dockerfile` | Build a Node-capable image that contains the official `cloudflared` binary. |
| `container-image-builds` | `.github/workflows/publish-cloudflared-agent-image.yml` | Build, smoke-test, and publish `assistos/cloudflared-agent:node24-cloudflared`. |
| `container-image-builds` | `README.md` | Document the new image and manual publishing command. |
| `basic` | `cloudflared/manifest.json` | Switch the agent to the custom image, run supervisor plus AgentServer sidecar, define secret/config env, and keep no direct HTTP exposure. |
| `basic` | `cloudflared/mcp-config.json` | Register admin-only MCP tools for status, validation, and config application. |
| `basic` | `cloudflared/runtime/cloudflared-supervisor.mjs` | Start and supervise `cloudflared tunnel --no-autoupdate run`; write redacted process status. |
| `basic` | `cloudflared/tools/cloudflared-tool.mjs` | Read MCP stdin, dispatch `cloudflared_status`, `cloudflared_routes_validate`, and `cloudflared_routes_apply`. |
| `basic` | `cloudflared/lib/routes.mjs` | Normalize route input, validate hostnames/paths/origins, build Cloudflare ingress rules, and load/store desired route state. |
| `basic` | `cloudflared/lib/cloudflare-api.mjs` | Minimal Cloudflare API client for tunnel config and DNS CNAME record upsert. |
| `basic` | `cloudflared/README.md` | Explain production profile enablement, dashboard behavior, secrets, `--publish`, and LiveKit/OnlyOffice boundaries. |
| `basic` | `tests/unit/cloudflaredManifest.test.mjs` | Update existing manifest expectations for custom-image and admin MCP contract. |
| `basic` | `tests/unit/cloudflaredRoutes.test.mjs` | Cover route validation and ingress generation without network calls. |
| `AssistOSExplorer` | `explorer/manifest.json` | Add `profiles.prod.enable` for `basic/cloudflared global no-wait` and an admin-only `ideSettings` entry. |
| `AssistOSExplorer` | `explorer/IDE-plugins/cloudflared-settings/config.json` | Register a hidden global Settings plugin keyed as `explorer/cloudflared-settings`. |
| `AssistOSExplorer` | `explorer/IDE-plugins/cloudflared-settings/cloudflared-settings/cloudflared-settings.{html,css,js}` | Admin dashboard UI for status, route editing, validation, and apply. |
| `AssistOSExplorer` | `explorer/tests/unit/manifestProfileCloudflared.test.js` | Assert cloudflared is profile-only and absent from default enablement. |
| `AssistOSExplorer` | `explorer/tests/unit/cloudflaredSettingsPlugin.test.js` | Assert plugin config and `ideSettings` aggregate into an admin-only Settings item. |
| `AssistOSExplorer` | `docs/specs/DS06-ploinky-runtime-invariants.md` | Record production-only cloudflared enablement and router-bound admin dashboard. |
| `AssistOSExplorer` | `docs/index.html` or `docs/deploy-skills-explorer.md` | Link or describe the production Cloudflare Tunnel dashboard and publish-port caveats. |

## Task 1: Add The Custom Image Definition

**Files:**

| Action | Path |
| --- | --- |
| Create | `/Users/danielsava/work/file-parser/container-image-builds/images/cloudflared-agent/Dockerfile` |
| Create | `/Users/danielsava/work/file-parser/container-image-builds/.github/workflows/publish-cloudflared-agent-image.yml` |
| Modify | `/Users/danielsava/work/file-parser/container-image-builds/README.md` |

- [ ] **Step 1: Create the Dockerfile**

Create `/Users/danielsava/work/file-parser/container-image-builds/images/cloudflared-agent/Dockerfile` with:

```dockerfile
ARG CLOUDFLARED_IMAGE=docker.io/cloudflare/cloudflared:latest
ARG BASE_IMAGE=docker.io/assistos/ploinky-node:24-bookworm-tools

FROM ${CLOUDFLARED_IMAGE} AS cloudflared

FROM ${BASE_IMAGE}

USER root
ENV NODE_ENV=production

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared

RUN set -eu; \
    command -v cloudflared >/dev/null 2>&1; \
    cloudflared --version; \
    node --version; \
    npm --version

WORKDIR /code
CMD ["node", "/code/runtime/cloudflared-supervisor.mjs"]
```

- [ ] **Step 2: Create the publish workflow**

Create `/Users/danielsava/work/file-parser/container-image-builds/.github/workflows/publish-cloudflared-agent-image.yml` with:

```yaml
name: Publish cloudflared agent image

on:
  workflow_dispatch:
    inputs:
      cloudflared_image:
        description: 'Cloudflare cloudflared image to copy from'
        required: false
        default: 'docker.io/cloudflare/cloudflared:latest'
        type: string
      base_image:
        description: 'Node-capable Ploinky base image'
        required: false
        default: 'docker.io/assistos/ploinky-node:24-bookworm-tools'
        type: string
      image_tag:
        description: 'Docker Hub tag to publish'
        required: false
        default: 'node24-cloudflared'
        type: string
  push:
    branches:
      - main
    paths:
      - 'images/cloudflared-agent/**'
      - '.github/workflows/publish-cloudflared-agent-image.yml'

permissions:
  contents: read
  packages: write

concurrency:
  group: publish-cloudflared-agent-image
  cancel-in-progress: false

env:
  IMAGE_NAME: assistos/cloudflared-agent
  DEFAULT_CLOUDFLARED_IMAGE: docker.io/cloudflare/cloudflared:latest
  DEFAULT_BASE_IMAGE: docker.io/assistos/ploinky-node:24-bookworm-tools
  DEFAULT_IMAGE_TAG: node24-cloudflared

jobs:
  publish:
    name: Build and push Docker Hub image
    runs-on: ubuntu-latest
    steps:
      - name: Checkout image definitions
        uses: actions/checkout@v4

      - name: Resolve image inputs
        id: image
        run: |
          set -euo pipefail
          cloudflared_image="${{ github.event.inputs.cloudflared_image }}"
          base_image="${{ github.event.inputs.base_image }}"
          image_tag="${{ github.event.inputs.image_tag }}"
          if [ -z "$cloudflared_image" ]; then
            cloudflared_image="$DEFAULT_CLOUDFLARED_IMAGE"
          fi
          if [ -z "$base_image" ]; then
            base_image="$DEFAULT_BASE_IMAGE"
          fi
          if [ -z "$image_tag" ]; then
            image_tag="$DEFAULT_IMAGE_TAG"
          fi
          echo "cloudflared_image=$cloudflared_image" >> "$GITHUB_OUTPUT"
          echo "base_image=$base_image" >> "$GITHUB_OUTPUT"
          echo "image_tag=$image_tag" >> "$GITHUB_OUTPUT"

      - name: Smoke build local architecture
        run: |
          set -euo pipefail
          docker build \
            --build-arg CLOUDFLARED_IMAGE='${{ steps.image.outputs.cloudflared_image }}' \
            --build-arg BASE_IMAGE='${{ steps.image.outputs.base_image }}' \
            -t "$IMAGE_NAME:smoke" \
            images/cloudflared-agent
          docker run --rm "$IMAGE_NAME:smoke" sh -lc 'cloudflared --version && node --version && npm --version'

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: assistos
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=${{ steps.image.outputs.image_tag }}
            type=sha,prefix=${{ steps.image.outputs.image_tag }}-

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: images/cloudflared-agent
          platforms: linux/amd64,linux/arm64
          push: true
          build-args: |
            CLOUDFLARED_IMAGE=${{ steps.image.outputs.cloudflared_image }}
            BASE_IMAGE=${{ steps.image.outputs.base_image }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: false
```

- [ ] **Step 3: Update the image catalog README**

Modify `/Users/danielsava/work/file-parser/container-image-builds/README.md`:

```diff
 | `assistos/webtty-agent:node24` | this repo | `images/webtty-agent` | `images/webtty-agent/Dockerfile` | `publish-webtty-agent-image.yml` |
+| `assistos/cloudflared-agent:node24-cloudflared` | this repo | `images/cloudflared-agent` | `images/cloudflared-agent/Dockerfile` | `publish-cloudflared-agent-image.yml` |
```

Add this manual publishing command near the other `gh workflow run` commands:

```sh
gh workflow run publish-cloudflared-agent-image.yml \
  --repo AssistOS-AI/container-image-builds \
  -f image_tag=node24-cloudflared
```

- [ ] **Step 4: Smoke-build the image locally**

Run:

```bash
docker build -t assistos/cloudflared-agent:smoke /Users/danielsava/work/file-parser/container-image-builds/images/cloudflared-agent
docker run --rm assistos/cloudflared-agent:smoke sh -lc 'cloudflared --version && node --version && npm --version'
```

Expected: the build succeeds, and the second command prints a `cloudflared` version plus Node and npm versions.

- [ ] **Step 5: Commit the image repo changes**

Run:

```bash
cd /Users/danielsava/work/file-parser/container-image-builds
git status --short
git add images/cloudflared-agent/Dockerfile .github/workflows/publish-cloudflared-agent-image.yml README.md
git commit -m "Add cloudflared agent image"
```

Expected: commit succeeds on branch `ploinky-box`.

## Task 2: Convert `basic/cloudflared` Into A Custom MCP Agent

**Files:**

| Action | Path |
| --- | --- |
| Modify | `/Users/danielsava/work/file-parser/basic/cloudflared/manifest.json` |
| Create | `/Users/danielsava/work/file-parser/basic/cloudflared/mcp-config.json` |
| Create | `/Users/danielsava/work/file-parser/basic/cloudflared/runtime/cloudflared-supervisor.mjs` |
| Create | `/Users/danielsava/work/file-parser/basic/cloudflared/lib/routes.mjs` |
| Create | `/Users/danielsava/work/file-parser/basic/cloudflared/lib/cloudflare-api.mjs` |
| Create | `/Users/danielsava/work/file-parser/basic/cloudflared/tools/cloudflared-tool.mjs` |

- [ ] **Step 1: Update the manifest contract**

Replace `/Users/danielsava/work/file-parser/basic/cloudflared/manifest.json` with:

```json
{
  "container": "docker.io/assistos/cloudflared-agent:node24-cloudflared",
  "about": "Cloudflare Tunnel connector and admin control plane for exposing selected Ploinky box HTTP and WebSocket surfaces through Cloudflare Tunnel.",
  "start": "node /code/runtime/cloudflared-supervisor.mjs",
  "agent": "sh /Agent/server/AgentServer.sh",
  "readiness": {
    "protocol": "mcp"
  },
  "endpoints": {
    "agent-card": {
      "name": "Cloudflare Tunnel",
      "description": "Runs cloudflared inside ploinky-box and exposes admin-only tunnel route management tools.",
      "tags": [
        "cloudflare",
        "tunnel",
        "admin"
      ]
    }
  },
  "profiles": {
    "default": {
      "mounts": {
        "code": "ro"
      },
      "env": {
        "TUNNEL_TOKEN": {
          "varName": "CLOUDFLARED_TUNNEL_TOKEN",
          "required": true
        },
        "CLOUDFLARE_API_TOKEN": {
          "required": false
        },
        "CLOUDFLARE_ACCOUNT_ID": {
          "required": false
        },
        "CLOUDFLARE_ZONE_ID": {
          "required": false
        },
        "CLOUDFLARE_TUNNEL_ID": {
          "required": false
        },
        "CLOUDFLARE_BASE_DOMAIN": {
          "required": false
        },
        "CLOUDFLARED_ALLOWED_ORIGINS_JSON": {
          "required": false
        },
        "CLOUDFLARED_STATE_FILE": {
          "default": "/root/cloudflared/routes.json"
        },
        "CLOUDFLARED_STATUS_FILE": {
          "default": "/root/cloudflared/status.json"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Register admin MCP tools**

Create `/Users/danielsava/work/file-parser/basic/cloudflared/mcp-config.json`:

```json
{
  "tools": [
    {
      "name": "cloudflared_status",
      "title": "Cloudflared status",
      "description": "Return redacted tunnel process, environment, and saved route status.",
      "command": "node",
      "args": [
        "tools/cloudflared-tool.mjs"
      ],
      "cwd": "/code",
      "timeoutMs": 30000,
      "env": {
        "TOOL_NAME": "cloudflared_status"
      },
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "tags": [
        "admin"
      ]
    },
    {
      "name": "cloudflared_routes_validate",
      "title": "Validate Cloudflare tunnel routes",
      "description": "Validate requested tunnel routes and return the Cloudflare ingress preview without mutating Cloudflare or local state.",
      "command": "node",
      "args": [
        "tools/cloudflared-tool.mjs"
      ],
      "cwd": "/code",
      "timeoutMs": 30000,
      "env": {
        "TOOL_NAME": "cloudflared_routes_validate"
      },
      "inputSchema": {
        "type": "object",
        "properties": {
          "routes": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "enabled": {
                  "type": "boolean"
                },
                "hostname": {
                  "type": "string"
                },
                "path": {
                  "type": "string"
                },
                "originId": {
                  "type": "string"
                },
                "service": {
                  "type": "string"
                },
                "description": {
                  "type": "string"
                }
              },
              "required": [
                "hostname",
                "originId"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "routes"
        ],
        "additionalProperties": false
      },
      "tags": [
        "admin"
      ]
    },
    {
      "name": "cloudflared_routes_apply",
      "title": "Apply Cloudflare tunnel routes",
      "description": "Validate, persist, and apply tunnel routes to the configured Cloudflare tunnel, optionally creating CNAME DNS records.",
      "command": "node",
      "args": [
        "tools/cloudflared-tool.mjs"
      ],
      "cwd": "/code",
      "timeoutMs": 60000,
      "env": {
        "TOOL_NAME": "cloudflared_routes_apply"
      },
      "inputSchema": {
        "type": "object",
        "properties": {
          "routes": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "enabled": {
                  "type": "boolean"
                },
                "hostname": {
                  "type": "string"
                },
                "path": {
                  "type": "string"
                },
                "originId": {
                  "type": "string"
                },
                "service": {
                  "type": "string"
                },
                "description": {
                  "type": "string"
                }
              },
              "required": [
                "hostname",
                "originId"
              ],
              "additionalProperties": false
            }
          },
          "createDnsRecords": {
            "type": "boolean"
          }
        },
        "required": [
          "routes"
        ],
        "additionalProperties": false
      },
      "tags": [
        "admin"
      ]
    }
  ]
}
```

- [ ] **Step 3: Add the tunnel supervisor**

Create `/Users/danielsava/work/file-parser/basic/cloudflared/runtime/cloudflared-supervisor.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const statusFile = process.env.CLOUDFLARED_STATUS_FILE || '/root/cloudflared/status.json';

async function writeStatus(update) {
  const payload = {
    updatedAt: new Date().toISOString(),
    ...update
  };
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(statusFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function redactArgs(args) {
  return args.map((arg) => String(arg).replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-token]'));
}

async function main() {
  const args = ['tunnel', '--no-autoupdate', 'run'];
  const tokenPresent = Boolean(String(process.env.TUNNEL_TOKEN || '').trim());

  await writeStatus({
    state: tokenPresent ? 'starting' : 'missing-token',
    pid: null,
    command: 'cloudflared',
    args: redactArgs(args),
    tokenPresent
  });

  if (!tokenPresent) {
    process.stderr.write('[cloudflared] TUNNEL_TOKEN is required.\n');
    setInterval(() => {}, 60_000);
    return;
  }

  const child = spawn('cloudflared', args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env
  });

  await writeStatus({
    state: 'running',
    pid: child.pid,
    command: 'cloudflared',
    args: redactArgs(args),
    tokenPresent
  });

  const stop = (signal) => {
    child.kill(signal);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  child.on('exit', async (code, signal) => {
    await writeStatus({
      state: 'exited',
      pid: child.pid,
      code,
      signal,
      command: 'cloudflared',
      args: redactArgs(args),
      tokenPresent
    });
    process.exitCode = typeof code === 'number' ? code : 1;
  });
}

main().catch(async (error) => {
  await writeStatus({
    state: 'failed',
    error: error?.message || String(error),
    pid: null
  }).catch(() => {});
  process.stderr.write(`[cloudflared] ${error?.stack || error}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Implement route validation and ingress generation**

Create `/Users/danielsava/work/file-parser/basic/cloudflared/lib/routes.mjs` with these exported functions:

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STATE_FILE = '/root/cloudflared/routes.json';
const HOST_GATEWAY = 'host.containers.internal';
const DEFAULT_ORIGINS = [
  {
    id: 'router',
    label: 'Ploinky router',
    service: 'http://host.containers.internal:8080',
    description: 'Router-hosted Explorer and agent HTTP/WebSocket surfaces.'
  },
  {
    id: 'onlyoffice',
    label: 'OnlyOffice Document Server',
    service: 'http://host.containers.internal:8082',
    description: 'OnlyOffice editor surface when the ploinky-box host port is published.'
  }
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePathPattern(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (!raw.startsWith('/')) {
    throw new Error('Route path must be empty or start with "/".');
  }
  if (/[\u0000-\u001f]/.test(raw)) {
    throw new Error('Route path contains control characters.');
  }
  if (raw.length > 256) {
    throw new Error('Route path must be at most 256 characters.');
  }
  return raw;
}

function normalizeHostname(value, { baseDomain }) {
  const raw = normalizeString(value).toLowerCase().replace(/\.+$/g, '');
  if (!raw) throw new Error('Route hostname is required.');
  if (raw.includes('*')) throw new Error('Wildcard hostnames are not enabled for this dashboard.');
  if (!/^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/.test(raw)) {
    throw new Error(`Invalid route hostname: ${value}`);
  }
  if (baseDomain) {
    const normalizedBase = baseDomain.toLowerCase().replace(/^\.+|\.+$/g, '');
    if (raw !== normalizedBase && !raw.endsWith(`.${normalizedBase}`)) {
      throw new Error(`Hostname ${raw} must be under ${normalizedBase}.`);
    }
  }
  return raw;
}

function normalizeService(value) {
  const raw = normalizeString(value);
  if (!raw) throw new Error('Route service is required.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid route service URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Route service must use http or https.');
  }
  if (parsed.hostname !== HOST_GATEWAY) {
    throw new Error(`Route service host must be ${HOST_GATEWAY}.`);
  }
  if (!parsed.port) {
    throw new Error('Route service must include an explicit port.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Route service must be an origin URL without path, query, or fragment.');
  }
  if (parsed.port === '7000') {
    throw new Error('Do not tunnel raw Ploinky AgentServer/MCP port 7000.');
  }
  return `${parsed.protocol}//${HOST_GATEWAY}:${parsed.port}`;
}

export function loadOriginPresets(env = process.env) {
  const raw = normalizeString(env.CLOUDFLARED_ALLOWED_ORIGINS_JSON);
  if (!raw) return DEFAULT_ORIGINS;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CLOUDFLARED_ALLOWED_ORIGINS_JSON must be valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('CLOUDFLARED_ALLOWED_ORIGINS_JSON must be an array.');
  }
  const origins = parsed.map((entry) => ({
    id: normalizeString(entry?.id),
    label: normalizeString(entry?.label),
    service: normalizeService(entry?.service),
    description: normalizeString(entry?.description)
  }));
  if (!origins.length || origins.some((entry) => !entry.id || !entry.label || !entry.service)) {
    throw new Error('Every allowed origin requires id, label, and service.');
  }
  return origins;
}

export function normalizeRoutes(inputRoutes, { env = process.env } = {}) {
  if (!Array.isArray(inputRoutes)) {
    throw new Error('routes must be an array.');
  }
  const baseDomain = normalizeString(env.CLOUDFLARE_BASE_DOMAIN);
  const origins = loadOriginPresets(env);
  const originById = new Map(origins.map((origin) => [origin.id, origin]));
  const seen = new Set();
  const routes = inputRoutes.map((entry, index) => {
    const originId = normalizeString(entry?.originId);
    const origin = originById.get(originId);
    if (!origin) throw new Error(`Unknown originId at route ${index + 1}: ${originId || '(empty)'}`);
    const hostname = normalizeHostname(entry?.hostname, { baseDomain });
    const pathPattern = normalizePathPattern(entry?.path);
    const key = `${hostname}\n${pathPattern}`;
    if (seen.has(key)) throw new Error(`Duplicate route for ${hostname}${pathPattern || '/'}.`);
    seen.add(key);
    const requestedService = normalizeString(entry?.service);
    const service = requestedService ? normalizeService(requestedService) : origin.service;
    if (service !== origin.service) {
      throw new Error(`Route service for origin ${originId} must equal ${origin.service}.`);
    }
    return {
      id: normalizeString(entry?.id) || `route_${index + 1}`,
      enabled: entry?.enabled !== false,
      hostname,
      path: pathPattern,
      originId,
      service,
      description: normalizeString(entry?.description)
    };
  });
  return { routes, origins };
}

export function buildIngress(routes) {
  const ingress = routes
    .filter((route) => route.enabled)
    .map((route) => ({
      hostname: route.hostname,
      ...(route.path ? { path: route.path } : {}),
      service: route.service
    }));
  ingress.push({ service: 'http_status:404' });
  return ingress;
}

export async function readRouteState({ env = process.env } = {}) {
  const stateFile = env.CLOUDFLARED_STATE_FILE || DEFAULT_STATE_FILE;
  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    const routes = Array.isArray(parsed?.routes) ? parsed.routes : [];
    return { version: 1, updatedAt: parsed?.updatedAt || '', routes };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { version: 1, updatedAt: '', routes: [] };
    }
    throw error;
  }
}

export async function writeRouteState(routes, { env = process.env } = {}) {
  const stateFile = env.CLOUDFLARED_STATE_FILE || DEFAULT_STATE_FILE;
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    routes
  };
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}
```

- [ ] **Step 5: Implement the Cloudflare API client**

Create `/Users/danielsava/work/file-parser/basic/cloudflared/lib/cloudflare-api.mjs`:

```js
function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getCloudflareConfig(env = process.env) {
  return {
    apiBaseUrl: normalizeString(env.CLOUDFLARE_API_BASE_URL) || 'https://api.cloudflare.com/client/v4',
    apiToken: normalizeString(env.CLOUDFLARE_API_TOKEN),
    accountId: normalizeString(env.CLOUDFLARE_ACCOUNT_ID),
    zoneId: normalizeString(env.CLOUDFLARE_ZONE_ID),
    tunnelId: normalizeString(env.CLOUDFLARE_TUNNEL_ID)
  };
}

export function describeCloudflareConfig(env = process.env) {
  const config = getCloudflareConfig(env);
  return {
    apiTokenConfigured: Boolean(config.apiToken),
    accountIdConfigured: Boolean(config.accountId),
    zoneIdConfigured: Boolean(config.zoneId),
    tunnelIdConfigured: Boolean(config.tunnelId),
    tunnelId: config.tunnelId,
    ready: Boolean(config.apiToken && config.accountId && config.zoneId && config.tunnelId)
  };
}

function requireCloudflareConfig(env = process.env) {
  const config = getCloudflareConfig(env);
  const missing = [];
  if (!config.apiToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (!config.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!config.zoneId) missing.push('CLOUDFLARE_ZONE_ID');
  if (!config.tunnelId) missing.push('CLOUDFLARE_TUNNEL_ID');
  if (missing.length) {
    throw new Error(`Missing Cloudflare configuration: ${missing.join(', ')}`);
  }
  return config;
}

async function requestCloudflare(config, method, pathname, body = undefined) {
  const response = await fetch(`${config.apiBaseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok || parsed?.success === false) {
    const message = parsed?.errors?.[0]?.message || text || `Cloudflare API returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed?.result ?? parsed;
}

export async function putTunnelIngress(ingress, { env = process.env } = {}) {
  const config = requireCloudflareConfig(env);
  return requestCloudflare(
    config,
    'PUT',
    `/accounts/${encodeURIComponent(config.accountId)}/cfd_tunnel/${encodeURIComponent(config.tunnelId)}/configurations`,
    { config: { ingress } }
  );
}

export async function upsertDnsRecords(routes, { env = process.env } = {}) {
  const config = requireCloudflareConfig(env);
  const enabledHostnames = Array.from(new Set(routes.filter((route) => route.enabled).map((route) => route.hostname)));
  const results = [];
  for (const hostname of enabledHostnames) {
    const query = new URLSearchParams({ type: 'CNAME', name: hostname });
    const existingRecords = await requestCloudflare(
      config,
      'GET',
      `/zones/${encodeURIComponent(config.zoneId)}/dns_records?${query.toString()}`
    );
    const existing = Array.isArray(existingRecords) ? existingRecords[0] : null;
    const body = {
      type: 'CNAME',
      name: hostname,
      content: `${config.tunnelId}.cfargotunnel.com`,
      ttl: 1,
      proxied: true
    };
    if (existing?.id) {
      const updated = await requestCloudflare(
        config,
        'PATCH',
        `/zones/${encodeURIComponent(config.zoneId)}/dns_records/${encodeURIComponent(existing.id)}`,
        body
      );
      results.push({ hostname, action: 'updated', id: updated?.id || existing.id });
    } else {
      const created = await requestCloudflare(
        config,
        'POST',
        `/zones/${encodeURIComponent(config.zoneId)}/dns_records`,
        body
      );
      results.push({ hostname, action: 'created', id: created?.id || '' });
    }
  }
  return results;
}
```

- [ ] **Step 6: Implement the MCP command dispatcher**

Create `/Users/danielsava/work/file-parser/basic/cloudflared/tools/cloudflared-tool.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs/promises';
import {
  buildIngress,
  loadOriginPresets,
  normalizeRoutes,
  readRouteState,
  writeRouteState
} from '../lib/routes.mjs';
import {
  describeCloudflareConfig,
  putTunnelIngress,
  upsertDnsRecords
} from '../lib/cloudflare-api.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function parsePayload(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      tool: String(parsed?.tool || process.env.TOOL_NAME || '').trim(),
      input: parsed?.input && typeof parsed.input === 'object' ? parsed.input : {}
    };
  } catch {
    return {
      tool: String(process.env.TOOL_NAME || '').trim(),
      input: {}
    };
  }
}

async function readStatusFile(env = process.env) {
  const statusFile = env.CLOUDFLARED_STATUS_FILE || '/root/cloudflared/status.json';
  try {
    return JSON.parse(await fs.readFile(statusFile, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { state: 'unknown', updatedAt: '', pid: null };
    }
    return { state: 'unreadable', updatedAt: '', pid: null, error: error?.message || String(error) };
  }
}

async function status() {
  const state = await readRouteState();
  return {
    ok: true,
    status: await readStatusFile(),
    cloudflare: describeCloudflareConfig(),
    tunnelTokenConfigured: Boolean(String(process.env.TUNNEL_TOKEN || '').trim()),
    baseDomain: String(process.env.CLOUDFLARE_BASE_DOMAIN || '').trim(),
    origins: loadOriginPresets(),
    routes: state.routes,
    updatedAt: state.updatedAt
  };
}

async function validate(input) {
  const { routes, origins } = normalizeRoutes(input.routes || []);
  return {
    ok: true,
    origins,
    routes,
    ingress: buildIngress(routes)
  };
}

async function apply(input) {
  const { routes, origins } = normalizeRoutes(input.routes || []);
  const ingress = buildIngress(routes);
  const cloudflareResult = await putTunnelIngress(ingress);
  const dns = input.createDnsRecords === false
    ? []
    : await upsertDnsRecords(routes);
  const state = await writeRouteState(routes);
  return {
    ok: true,
    origins,
    routes,
    ingress,
    dns,
    cloudflareResult,
    updatedAt: state.updatedAt
  };
}

async function main() {
  const { tool, input } = parsePayload(await readStdin());
  let result;
  if (tool === 'cloudflared_status') result = await status();
  else if (tool === 'cloudflared_routes_validate') result = await validate(input);
  else if (tool === 'cloudflared_routes_apply') result = await apply(input);
  else throw new Error(`Unknown cloudflared tool: ${tool}`);
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  process.stderr.write(`${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 7: Run a local no-network tool smoke**

Run:

```bash
cd /Users/danielsava/work/file-parser/basic/cloudflared
TOOL_NAME=cloudflared_routes_validate CLOUDFLARE_BASE_DOMAIN=example.com node tools/cloudflared-tool.mjs <<'JSON'
{"input":{"routes":[{"hostname":"explorer.example.com","originId":"router"}]}}
JSON
```

Expected: JSON with `"ok":true` and an `ingress` array ending in `{"service":"http_status:404"}`.

## Task 3: Test And Document `basic/cloudflared`

**Files:**

| Action | Path |
| --- | --- |
| Modify | `/Users/danielsava/work/file-parser/basic/tests/unit/cloudflaredManifest.test.mjs` |
| Create | `/Users/danielsava/work/file-parser/basic/tests/unit/cloudflaredRoutes.test.mjs` |
| Modify | `/Users/danielsava/work/file-parser/basic/cloudflared/README.md` |

- [ ] **Step 1: Update manifest tests before implementation**

Change the first test in `/Users/danielsava/work/file-parser/basic/tests/unit/cloudflaredManifest.test.mjs` to expect:

```js
test('cloudflared manifest runs the custom Cloudflare Tunnel MCP agent image', () => {
    const manifest = readCloudflaredManifest();

    assert.equal(manifest.container, 'docker.io/assistos/cloudflared-agent:node24-cloudflared');
    assert.match(manifest.about, /Cloudflare Tunnel connector and admin control plane/);
    assert.equal(manifest.start, 'node /code/runtime/cloudflared-supervisor.mjs');
    assert.equal(manifest.agent, 'sh /Agent/server/AgentServer.sh');
    assert.equal(manifest.readiness?.protocol, 'mcp');
});
```

Replace `forbiddenExposureFields` with:

```js
const forbiddenExposureFields = [
    'routerAccess',
    'httpServices',
    'guest',
    'ssoProvider',
    'ports',
    'openPorts',
];
```

Keep the "no direct public or router exposure" assertion intact.

- [ ] **Step 2: Add route validation tests**

Create `/Users/danielsava/work/file-parser/basic/tests/unit/cloudflaredRoutes.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildIngress,
    loadOriginPresets,
    normalizeRoutes
} from '../../cloudflared/lib/routes.mjs';

test('normalizeRoutes accepts hostnames under the configured base domain', () => {
    const { routes } = normalizeRoutes([
        { hostname: 'explorer.example.com', originId: 'router' }
    ], {
        env: { CLOUDFLARE_BASE_DOMAIN: 'example.com' }
    });

    assert.deepEqual(routes, [
        {
            id: 'route_1',
            enabled: true,
            hostname: 'explorer.example.com',
            path: '',
            originId: 'router',
            service: 'http://host.containers.internal:8080',
            description: ''
        }
    ]);
});

test('buildIngress appends a catch-all 404 rule', () => {
    const { routes } = normalizeRoutes([
        { hostname: 'office.example.com', path: '/office', originId: 'onlyoffice' }
    ], {
        env: { CLOUDFLARE_BASE_DOMAIN: 'example.com' }
    });

    assert.deepEqual(buildIngress(routes), [
        {
            hostname: 'office.example.com',
            path: '/office',
            service: 'http://host.containers.internal:8082'
        },
        { service: 'http_status:404' }
    ]);
});

test('normalizeRoutes rejects hostnames outside the base domain', () => {
    assert.throws(
        () => normalizeRoutes([
            { hostname: 'explorer.bad.test', originId: 'router' }
        ], {
            env: { CLOUDFLARE_BASE_DOMAIN: 'example.com' }
        }),
        /must be under example\.com/
    );
});

test('normalizeRoutes rejects raw AgentServer port exposure', () => {
    assert.throws(
        () => normalizeRoutes([
            {
                hostname: 'agent.example.com',
                originId: 'custom',
                service: 'http://host.containers.internal:7000'
            }
        ], {
            env: {
                CLOUDFLARE_BASE_DOMAIN: 'example.com',
                CLOUDFLARED_ALLOWED_ORIGINS_JSON: JSON.stringify([
                    {
                        id: 'custom',
                        label: 'Unsafe raw agent port',
                        service: 'http://host.containers.internal:7000'
                    }
                ])
            }
        }),
        /AgentServer\/MCP port 7000/
    );
});

test('loadOriginPresets accepts explicit published host origins', () => {
    const origins = loadOriginPresets({
        CLOUDFLARED_ALLOWED_ORIGINS_JSON: JSON.stringify([
            {
                id: 'livekit-http',
                label: 'LiveKit HTTP signaling',
                service: 'http://host.containers.internal:7880'
            }
        ])
    });

    assert.equal(origins.length, 1);
    assert.equal(origins[0].service, 'http://host.containers.internal:7880');
});
```

- [ ] **Step 3: Run the tests and confirm they fail for the old implementation**

Run:

```bash
cd /Users/danielsava/work/file-parser/basic
node --test tests/unit/cloudflaredManifest.test.mjs tests/unit/cloudflaredRoutes.test.mjs
```

Expected before implementation: failures because `mcp-config.json`, `lib/routes.mjs`, and the custom image manifest are not present.

- [ ] **Step 4: Run the tests after Task 2**

Run the same command:

```bash
cd /Users/danielsava/work/file-parser/basic
node --test tests/unit/cloudflaredManifest.test.mjs tests/unit/cloudflaredRoutes.test.mjs
```

Expected after Task 2: all tests pass.

- [ ] **Step 5: Update the README**

Rewrite the top sections of `/Users/danielsava/work/file-parser/basic/cloudflared/README.md` so they state:

```markdown
# Cloudflared

`basic/cloudflared` runs Cloudflare Tunnel from inside ploinky-box and exposes admin-only MCP tools for managing a remotely configured Cloudflare Tunnel. The browser dashboard lives in Explorer Settings, but all tunnel mutations go through the `agent:basic/cloudflared` MCP tools and the Ploinky router.

## Runtime

The agent uses `docker.io/assistos/cloudflared-agent:node24-cloudflared`. The image copies the official `cloudflared` binary from `docker.io/cloudflare/cloudflared:latest` into the Ploinky Node runtime image so the container can run both:

| Process | Purpose |
| --- | --- |
| `node /code/runtime/cloudflared-supervisor.mjs` | Main process; starts `cloudflared tunnel --no-autoupdate run` and writes redacted status. |
| `sh /Agent/server/AgentServer.sh` | Sidecar; exposes admin MCP tools through the Ploinky router. |

## Required Secrets And Config

Set secrets with `ploinky var`; do not commit token values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARED_TUNNEL_TOKEN` | yes | Token consumed as `TUNNEL_TOKEN` by `cloudflared`. |
| `CLOUDFLARE_API_TOKEN` | for dashboard apply | Cloudflare API token with tunnel config and DNS permissions. |
| `CLOUDFLARE_ACCOUNT_ID` | for dashboard apply | Cloudflare account that owns the tunnel. |
| `CLOUDFLARE_ZONE_ID` | for dashboard DNS | Zone where dashboard-created CNAME records live. |
| `CLOUDFLARE_TUNNEL_ID` | for dashboard apply | Tunnel UUID. |
| `CLOUDFLARE_BASE_DOMAIN` | recommended | Limits dashboard hostnames to one domain suffix. |
| `CLOUDFLARED_ALLOWED_ORIGINS_JSON` | optional | JSON array of allowed `host.containers.internal:<port>` origins for published non-router HTTP services. |

## Ploinky Box Boundaries

Default production routing should point at the Ploinky router:

| Origin preset | Service URL | Notes |
| --- | --- | --- |
| `router` | `http://host.containers.internal:8080` | Router-hosted Explorer and agent HTTP/WebSocket surfaces. |
| `onlyoffice` | `http://host.containers.internal:8082` | Only works when that box-side host port is published. |

Cloudflare Tunnel can expose HTTP and WebSocket origins. It does not expose LiveKit UDP media by itself. LiveKit media and other direct data planes still need explicit `ploinky start explorer --publish HOST:BOX` mappings and their own app-level credentials.
```

- [ ] **Step 6: Commit the basic repo changes on `main`**

Run:

```bash
cd /Users/danielsava/work/file-parser/basic
git branch --show-current
git status --short
git add cloudflared tests/unit/cloudflaredManifest.test.mjs tests/unit/cloudflaredRoutes.test.mjs
git commit -m "Add cloudflared control plane agent"
```

Expected: current branch is `main`, and the commit contains only `cloudflared/` plus the two cloudflared tests. Do not stage the pre-existing untracked `docs/superpowers/` directory unless the user separately asks for it.

## Task 4: Enable Cloudflared Only In Explorer Production Profile

**Files:**

| Action | Path |
| --- | --- |
| Modify | `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/manifest.json` |
| Create | `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/tests/unit/manifestProfileCloudflared.test.js` |

- [ ] **Step 1: Add the failing profile test**

Create `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/tests/unit/manifestProfileCloudflared.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../../manifest.json');

function readManifest() {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function allEnableEntries(manifest) {
    const topLevel = Array.isArray(manifest.enable) ? manifest.enable : [];
    const profileEntries = Object.values(manifest.profiles || {})
        .flatMap((profile) => Array.isArray(profile.enable) ? profile.enable : []);
    return [...topLevel, ...profileEntries].map((entry) => JSON.stringify(entry));
}

test('cloudflared is not enabled by Explorer default startup', () => {
    const manifest = readManifest();
    const topLevelEnable = Array.isArray(manifest.enable) ? manifest.enable : [];
    const defaultEnable = Array.isArray(manifest.profiles?.default?.enable)
        ? manifest.profiles.default.enable
        : [];

    assert.equal(topLevelEnable.some((entry) => JSON.stringify(entry).includes('basic/cloudflared')), false);
    assert.equal(defaultEnable.some((entry) => JSON.stringify(entry).includes('basic/cloudflared')), false);
});

test('cloudflared is enabled only by Explorer prod profile', () => {
    const manifest = readManifest();
    const prodEnable = manifest.profiles?.prod?.enable || [];

    assert.deepEqual(prodEnable, [
        'basic/cloudflared global no-wait'
    ]);

    const allEntries = allEnableEntries(manifest)
        .filter((entry) => entry.includes('basic/cloudflared'));
    assert.deepEqual(allEntries, [
        JSON.stringify('basic/cloudflared global no-wait')
    ]);
});

test('cloudflared Settings entry is admin-only and points at the Explorer plugin', () => {
    const manifest = readManifest();
    const entry = (manifest.ideSettings || []).find((item) => item.key === 'cloudflared');

    assert.ok(entry);
    assert.equal(entry.label, 'Cloudflare Tunnel');
    assert.equal(entry.scope, 'workspace');
    assert.equal(entry.pluginKey, 'explorer/cloudflared-settings');
    assert.equal(entry.settingsComponent, 'cloudflared-settings');
    assert.equal(entry.adminOnly, true);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
node --test tests/unit/manifestProfileCloudflared.test.js
```

Expected before manifest update: fails because `profiles.prod` and `ideSettings.cloudflared` are missing.

- [ ] **Step 3: Update `explorer/manifest.json`**

Modify `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/manifest.json`:

```diff
     "applicationPlugins": {
         "git": true,
         "dpu-runtime-support": true,
         "dpu-audit-menu": true,
         "soplang-builder": true,
         "tasks": true,
         "webmeet": true,
-        "soul-gateway": true
+        "soul-gateway": true,
+        "cloudflared": true
     },
+    "ideSettings": [
+        {
+            "key": "cloudflared",
+            "label": "Cloudflare Tunnel",
+            "scope": "workspace",
+            "pluginKey": "explorer/cloudflared-settings",
+            "settingsComponent": "cloudflared-settings",
+            "adminOnly": true
+        }
+    ],
```

Add a `prod` profile beside the existing `default` profile:

```json
"prod": {
  "enable": [
    "basic/cloudflared global no-wait"
  ]
}
```

Do not add `basic/cloudflared` to top-level `enable` or `profiles.default.enable`.

- [ ] **Step 4: Run the profile test**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
node --test tests/unit/manifestProfileCloudflared.test.js
```

Expected: pass.

## Task 5: Add The Explorer Cloudflared Settings Dashboard

**Files:**

| Action | Path |
| --- | --- |
| Create | `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/config.json` |
| Create | `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/cloudflared-settings/cloudflared-settings.html` |
| Create | `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/cloudflared-settings/cloudflared-settings.css` |
| Create | `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/cloudflared-settings/cloudflared-settings.js` |
| Create | `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/tests/unit/cloudflaredSettingsPlugin.test.js` |

- [ ] **Step 1: Register the plugin**

Create `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/config.json`:

```json
{
  "pluginCategory": "application",
  "id": "cloudflared-settings",
  "component": "cloudflared-settings",
  "label": "Cloudflare Tunnel",
  "tooltip": "Configure Cloudflare Tunnel routes",
  "location": [],
  "type": "global",
  "adminOnly": true
}
```

- [ ] **Step 2: Create a dashboard template**

Create `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/cloudflared-settings/cloudflared-settings.html`:

```html
<div class="cloudflared-settings">
  <header class="cloudflared-settings__header">
    <div>
      <h2>Cloudflare Tunnel</h2>
      <p data-role="status">Loading tunnel status...</p>
    </div>
    <button type="button" data-action="refresh">Refresh</button>
  </header>

  <section class="cloudflared-settings__notice" data-role="notice" hidden></section>

  <section class="cloudflared-settings__grid">
    <div class="cloudflared-settings__panel">
      <h3>Origins</h3>
      <div data-role="origins"></div>
    </div>

    <div class="cloudflared-settings__panel">
      <h3>Routes</h3>
      <form data-role="route-form">
        <input name="hostname" type="text" autocomplete="off" placeholder="subdomain.example.com" required>
        <input name="path" type="text" autocomplete="off" placeholder="/optional-path">
        <select name="originId" required></select>
        <input name="description" type="text" autocomplete="off" placeholder="Description">
        <button type="submit">Add</button>
      </form>
      <div data-role="routes"></div>
    </div>
  </section>

  <footer class="cloudflared-settings__footer">
    <label>
      <input type="checkbox" data-role="create-dns" checked>
      Create or update DNS CNAME records
    </label>
    <div>
      <button type="button" data-action="validate">Validate</button>
      <button type="button" data-action="apply">Apply</button>
    </div>
  </footer>
</div>
```

- [ ] **Step 3: Create dashboard styles**

Create `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/cloudflared-settings/cloudflared-settings.css`:

```css
cloudflared-settings {
  display: block;
  color: var(--text);
}

cloudflared-settings .cloudflared-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: min(760px, calc(100vw - 36px));
  max-width: 980px;
}

cloudflared-settings h2,
cloudflared-settings h3,
cloudflared-settings p {
  margin: 0;
}

cloudflared-settings .cloudflared-settings__header,
cloudflared-settings .cloudflared-settings__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

cloudflared-settings .cloudflared-settings__header p,
cloudflared-settings .cloudflared-settings__notice {
  color: #64748b;
  font-size: 13px;
}

cloudflared-settings .cloudflared-settings__grid {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(360px, 1.2fr);
  gap: 14px;
  min-height: 0;
}

cloudflared-settings .cloudflared-settings__panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
}

cloudflared-settings [data-role="route-form"] {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(130px, 0.65fr);
  gap: 8px;
  margin: 10px 0;
}

cloudflared-settings input,
cloudflared-settings select,
cloudflared-settings button {
  min-height: 34px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 10px;
  font: inherit;
}

cloudflared-settings button {
  cursor: pointer;
  background: var(--bg);
  color: var(--text);
}

cloudflared-settings .route-row,
cloudflared-settings .origin-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}

cloudflared-settings .route-row:first-child,
cloudflared-settings .origin-row:first-child {
  border-top: 0;
}

cloudflared-settings .muted {
  color: #64748b;
  font-size: 12px;
}

@media (max-width: 760px) {
  cloudflared-settings .cloudflared-settings__grid,
  cloudflared-settings [data-role="route-form"] {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Implement dashboard behavior**

Create `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/IDE-plugins/cloudflared-settings/cloudflared-settings/cloudflared-settings.js`:

```js
import {
  callAgentTool,
  parseToolResult
} from '/explorer/services/infrastructure/explorerApi.js';

function normalizeRoute(route) {
  return {
    id: String(route?.id || `route_${Date.now()}`).trim(),
    enabled: route?.enabled !== false,
    hostname: String(route?.hostname || '').trim(),
    path: String(route?.path || '').trim(),
    originId: String(route?.originId || '').trim(),
    service: String(route?.service || '').trim(),
    description: String(route?.description || '').trim()
  };
}

export class CloudflaredSettings {
  constructor(element, invalidate) {
    this.element = element;
    this.invalidate = invalidate;
    this.state = {
      busy: false,
      status: 'Loading tunnel status...',
      notice: '',
      origins: [],
      routes: []
    };
    this.invalidate();
  }

  async afterRender() {
    this.statusEl = this.element.querySelector('[data-role="status"]');
    this.noticeEl = this.element.querySelector('[data-role="notice"]');
    this.originsEl = this.element.querySelector('[data-role="origins"]');
    this.routesEl = this.element.querySelector('[data-role="routes"]');
    this.originSelect = this.element.querySelector('select[name="originId"]');
    this.form = this.element.querySelector('[data-role="route-form"]');
    this.createDnsEl = this.element.querySelector('[data-role="create-dns"]');

    this.element.querySelector('[data-action="refresh"]')?.addEventListener('click', this.refresh);
    this.element.querySelector('[data-action="validate"]')?.addEventListener('click', this.validate);
    this.element.querySelector('[data-action="apply"]')?.addEventListener('click', this.apply);
    this.form?.addEventListener('submit', this.addRoute);
    this.routesEl?.addEventListener('click', this.handleRouteClick);

    this.renderState();
    if (!this.loaded) {
      this.loaded = true;
      await this.refresh();
    }
  }

  afterUnload() {
    this.element.querySelector('[data-action="refresh"]')?.removeEventListener('click', this.refresh);
    this.element.querySelector('[data-action="validate"]')?.removeEventListener('click', this.validate);
    this.element.querySelector('[data-action="apply"]')?.removeEventListener('click', this.apply);
    this.form?.removeEventListener('submit', this.addRoute);
    this.routesEl?.removeEventListener('click', this.handleRouteClick);
  }

  setStatus(message, notice = '') {
    this.state.status = message;
    this.state.notice = notice;
    this.renderState();
  }

  callTool = async (name, args = {}) => {
    const result = await callAgentTool('cloudflared', name, args, { raw: true });
    return parseToolResult(result) || {};
  };

  refresh = async () => {
    this.state.busy = true;
    this.renderState();
    try {
      const payload = await this.callTool('cloudflared_status');
      this.state.origins = Array.isArray(payload.origins) ? payload.origins : [];
      this.state.routes = Array.isArray(payload.routes) ? payload.routes.map(normalizeRoute) : [];
      const ready = payload.cloudflare?.ready ? 'Cloudflare API configured' : 'Cloudflare API config incomplete';
      this.setStatus(`${payload.status?.state || 'unknown'} - ${ready}`);
    } catch (error) {
      this.setStatus(error?.message || 'Failed to load tunnel status.', 'Start Explorer with the production profile and confirm the cloudflared agent is running.');
    } finally {
      this.state.busy = false;
      this.renderState();
    }
  };

  validate = async () => {
    try {
      const payload = await this.callTool('cloudflared_routes_validate', { routes: this.state.routes });
      this.state.routes = Array.isArray(payload.routes) ? payload.routes.map(normalizeRoute) : this.state.routes;
      this.setStatus(`Valid route set: ${Math.max(0, (payload.ingress || []).length - 1)} active ingress rules.`);
    } catch (error) {
      this.setStatus('Validation failed.', error?.message || String(error));
    }
  };

  apply = async () => {
    try {
      const payload = await this.callTool('cloudflared_routes_apply', {
        routes: this.state.routes,
        createDnsRecords: this.createDnsEl?.checked !== false
      });
      this.state.routes = Array.isArray(payload.routes) ? payload.routes.map(normalizeRoute) : this.state.routes;
      this.setStatus(`Applied ${Math.max(0, (payload.ingress || []).length - 1)} ingress rules.`);
    } catch (error) {
      this.setStatus('Apply failed.', error?.message || String(error));
    }
  };

  addRoute = (event) => {
    event.preventDefault();
    const data = new FormData(this.form);
    const route = normalizeRoute({
      hostname: data.get('hostname'),
      path: data.get('path'),
      originId: data.get('originId'),
      description: data.get('description')
    });
    if (!route.hostname || !route.originId) return;
    this.state.routes = [...this.state.routes, route];
    this.form.reset();
    this.renderState();
  };

  handleRouteClick = (event) => {
    const button = event.target?.closest?.('[data-remove-route]');
    if (!button) return;
    const id = button.getAttribute('data-remove-route');
    this.state.routes = this.state.routes.filter((route) => route.id !== id);
    this.renderState();
  };

  renderState() {
    if (this.statusEl) this.statusEl.textContent = this.state.status;
    if (this.noticeEl) {
      this.noticeEl.textContent = this.state.notice;
      this.noticeEl.hidden = !this.state.notice;
    }
    if (this.originSelect) {
      this.originSelect.innerHTML = this.state.origins
        .map((origin) => `<option value="${origin.id}">${origin.label}</option>`)
        .join('');
    }
    if (this.originsEl) {
      this.originsEl.innerHTML = this.state.origins
        .map((origin) => `
          <div class="origin-row">
            <div>
              <strong>${origin.label}</strong>
              <div class="muted">${origin.service}</div>
            </div>
          </div>
        `)
        .join('');
    }
    if (this.routesEl) {
      this.routesEl.innerHTML = this.state.routes
        .map((route) => `
          <div class="route-row">
            <div>
              <strong>${route.hostname}${route.path || '/'}</strong>
              <div class="muted">${route.originId} -> ${route.service || '(preset)'}</div>
            </div>
            <button type="button" data-remove-route="${route.id}">Remove</button>
          </div>
        `)
        .join('');
    }
  }
}
```

- [ ] **Step 5: Add plugin aggregation tests**

Create `/Users/danielsava/work/file-parser/AssistOSExplorer/explorer/tests/unit/cloudflaredSettingsPlugin.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { aggregateIdePlugins } from '../../utils/ide-plugins.mjs';
import { buildAgentSettingsItems } from '../../web-components/modals/settings-modal/settings-agent-model.js';

test('Explorer exposes cloudflared settings as an admin-only agent setting', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-cloudflared-settings-'));
    try {
        const explorerDir = path.join(workspaceRoot, 'explorer');
        const pluginDir = path.join(explorerDir, 'IDE-plugins', 'cloudflared-settings');
        await fs.mkdir(pluginDir, { recursive: true });
        await fs.writeFile(path.join(explorerDir, 'manifest.json'), JSON.stringify({
            ideSettings: [
                {
                    key: 'cloudflared',
                    label: 'Cloudflare Tunnel',
                    scope: 'workspace',
                    pluginKey: 'explorer/cloudflared-settings',
                    settingsComponent: 'cloudflared-settings',
                    adminOnly: true
                }
            ]
        }, null, 2));
        await fs.writeFile(path.join(pluginDir, 'config.json'), JSON.stringify({
            pluginCategory: 'application',
            id: 'cloudflared-settings',
            component: 'cloudflared-settings',
            label: 'Cloudflare Tunnel',
            location: [],
            type: 'global',
            adminOnly: true
        }, null, 2));

        const aggregated = await aggregateIdePlugins(workspaceRoot);
        const plugin = aggregated.application[''][0];
        const items = buildAgentSettingsItems(aggregated.agentSettings, [{
            key: 'explorer/cloudflared-settings',
            agent: plugin.agent,
            component: plugin.component,
            pluginId: plugin.id,
            settingsComponent: plugin.component,
            assetRootPath: plugin.assetRootPath,
            adminOnly: plugin.adminOnly
        }]);

        assert.equal(plugin.agent, 'explorer');
        assert.equal(plugin.id, 'cloudflared-settings');
        assert.equal(plugin.adminOnly, true);
        assert.equal(items[0].key, 'cloudflared');
        assert.equal(items[0].available, true);
        assert.equal(items[0].settingsComponent, 'cloudflared-settings');
        assert.equal(items[0].adminOnly, true);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
});
```

- [ ] **Step 6: Run the Explorer plugin tests**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
node --test tests/unit/cloudflaredSettingsPlugin.test.js tests/unit/settingsModalPluginSettings.test.js tests/unit/idePluginsAggregation.test.js
```

Expected: all tests pass.

## Task 6: Update Explorer Docs And Runtime Spec

**Files:**

| Action | Path |
| --- | --- |
| Modify | `/Users/danielsava/work/file-parser/AssistOSExplorer/docs/specs/DS06-ploinky-runtime-invariants.md` |
| Modify | `/Users/danielsava/work/file-parser/AssistOSExplorer/docs/deploy-skills-explorer.md` |
| Modify | `/Users/danielsava/work/file-parser/AssistOSExplorer/docs/index.html` |

- [ ] **Step 1: Update DS06 production cloudflared contract**

In `/Users/danielsava/work/file-parser/AssistOSExplorer/docs/specs/DS06-ploinky-runtime-invariants.md`, add this paragraph after the paragraph about Ploinky profiles:

```markdown
Explorer's Cloudflare Tunnel integration is production-profile-only. `explorer/manifest.json` must enable `basic/cloudflared` only from `profiles.prod.enable`, never from top-level `enable` or `profiles.default.enable`, so local ploinky-box runs do not publish Cloudflare Tunnel connectors by accident. The cloudflared agent owns the tunnel process and its admin MCP tools; Explorer owns only the admin Settings dashboard. Browser configuration must call those tools through the Ploinky router and must not expose the cloudflared agent's raw port, MCP endpoint, or arbitrary box ports directly.
```

Add this sentence to the paragraph about declared media/data planes:

```markdown
Cloudflare Tunnel routes managed by the dashboard are HTTP/WebSocket ingress rules only; LiveKit UDP media, TURN, and any other direct data plane still require explicit `ploinky start explorer --publish HOST:BOX` mappings or equivalent infrastructure.
```

- [ ] **Step 2: Update deployment docs**

In `/Users/danielsava/work/file-parser/AssistOSExplorer/docs/deploy-skills-explorer.md`, add a section:

```markdown
## Production Cloudflare Tunnel

Production ploinky-box deployments use the `prod` profile to start `basic/cloudflared` as a non-blocking dependency of Explorer. Configure the required tunnel token and Cloudflare API values with `ploinky var`; do not store token values in manifests or docs.

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARED_TUNNEL_TOKEN` | Starts the remotely managed tunnel connector. |
| `CLOUDFLARE_API_TOKEN` | Lets the admin dashboard update tunnel ingress and DNS records. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for the tunnel. |
| `CLOUDFLARE_ZONE_ID` | DNS zone for CNAME records. |
| `CLOUDFLARE_TUNNEL_ID` | Tunnel UUID. |
| `CLOUDFLARE_BASE_DOMAIN` | Hostname suffix accepted by the dashboard. |

Start Explorer with the production profile before opening the Settings dashboard:

```sh
ploinky profile prod
ploinky start explorer --publish 127.0.0.1:8082:8082
```

Add further `--publish HOST:BOX` mappings only for direct HTTP or media surfaces that are explicitly documented by their owning agent. Cloudflare Tunnel HTTP ingress does not replace LiveKit UDP/TURN exposure.
```

- [ ] **Step 3: Link the deployment note from the docs index**

Modify `/Users/danielsava/work/file-parser/AssistOSExplorer/docs/index.html` so the deployment or architecture section includes a link to `deploy-skills-explorer.md` with visible text `Production Cloudflare Tunnel`.

- [ ] **Step 4: Run docs consistency tests**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
node --test tests/unit/docsConsistency.test.js
```

Expected: pass.

## Task 7: Validate Manifests, Tests, And Runtime Assumptions

- [ ] **Step 1: Validate `basic/cloudflared` with the Ploinky agent validator**

Run:

```bash
node /Users/danielsava/work/file-parser/.agents/skills/manage-ploinky-agents/scripts/validate-ploinky-agent.mjs \
  --agent-dir /Users/danielsava/work/file-parser/basic/cloudflared
```

Expected: validator exits `0`. If it rejects the MCP `inputSchema` shape, fix the schema to the validator-supported shape and rerun this exact command.

- [ ] **Step 2: Validate Explorer manifest and plugin tests**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
node --test tests/unit/manifestProfileCloudflared.test.js tests/unit/cloudflaredSettingsPlugin.test.js tests/unit/settingsModalPluginSettings.test.js tests/unit/idePluginsAggregation.test.js
```

Expected: pass.

- [ ] **Step 3: Run broad Explorer tests**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/explorer
npm test
```

Expected: `test:docs` and `test:unit` pass.

- [ ] **Step 4: Run basic cloudflared tests**

Run:

```bash
cd /Users/danielsava/work/file-parser/basic
node --test tests/unit/cloudflaredManifest.test.mjs tests/unit/cloudflaredRoutes.test.mjs
```

Expected: pass.

- [ ] **Step 5: Run image smoke build**

Run:

```bash
cd /Users/danielsava/work/file-parser/container-image-builds
docker build -t assistos/cloudflared-agent:smoke images/cloudflared-agent
docker run --rm assistos/cloudflared-agent:smoke sh -lc 'cloudflared --version && node --version && npm --version'
```

Expected: both commands succeed.

## Task 8: Commit And Push The Affected Repos

- [ ] **Step 1: Commit `AssistOSExplorer` branch**

Run:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer
git status --short
git add explorer/manifest.json explorer/IDE-plugins/cloudflared-settings explorer/tests/unit/manifestProfileCloudflared.test.js explorer/tests/unit/cloudflaredSettingsPlugin.test.js docs/specs/DS06-ploinky-runtime-invariants.md docs/deploy-skills-explorer.md docs/index.html docs/superpowers/plans/2026-07-08-custom-cloudflared-ploinky-box.md
git commit -m "Add cloudflared production dashboard plan"
git push -u origin ploinky-box
```

Expected: commit succeeds on branch `ploinky-box`; push creates or updates remote `origin/ploinky-box`. Do not stage the pre-existing untracked `userPersistoAgent/` directory.

- [ ] **Step 2: Commit `container-image-builds` branch**

Run:

```bash
cd /Users/danielsava/work/file-parser/container-image-builds
git status --short
git add images/cloudflared-agent/Dockerfile .github/workflows/publish-cloudflared-agent-image.yml README.md
git commit -m "Add cloudflared agent image"
git push -u origin ploinky-box
```

Expected: commit succeeds on branch `ploinky-box`; push creates or updates remote `origin/ploinky-box`.

- [ ] **Step 3: Commit `basic` main**

Run:

```bash
cd /Users/danielsava/work/file-parser/basic
git branch --show-current
git status --short
git add cloudflared tests/unit/cloudflaredManifest.test.mjs tests/unit/cloudflaredRoutes.test.mjs
git commit -m "Add cloudflared control plane agent"
```

Expected: branch output is `main`; commit succeeds. Do not push `main` until the user confirms that direct-main publishing is desired for this change.

## Self-Review Checklist

| Check | Expected result |
| --- | --- |
| Production-only enablement | Only `explorer/manifest.json` `profiles.prod.enable` contains `basic/cloudflared global no-wait`. |
| Router boundary | Explorer UI uses MCP tools; no new public `httpServices`, no raw agent port exposure, no direct MCP port tunnel. |
| Secrets | No raw Cloudflare token, tunnel token, JWT, or `PLOINKY_MASTER_KEY` appears in source, manifests, tests, or docs. |
| Cloudflare ingress safety | Generated ingress always ends with `http_status:404`; dashboard hostnames are constrained by `CLOUDFLARE_BASE_DOMAIN`; services must be `http(s)://host.containers.internal:<port>` and never port `7000`. |
| UI availability | Settings entry is `adminOnly: true` and unavailable to non-admin settings views. |
| LiveKit caveat | Docs state that Cloudflare HTTP Tunnel does not replace UDP/TURN/media-plane publish requirements. |
| Branch scope | `AssistOSExplorer` and `container-image-builds` use `ploinky-box`; `basic` remains on `main`; unaffected dependency repos are untouched. |
