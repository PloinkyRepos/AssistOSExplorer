#!/usr/bin/env bash
set -euo pipefail

# This hook runs on the HOST before container creation.
# Purpose: ensure ASSISTOS_FS_ROOT defaults to the current workspace directory
# so the Explorer exposes the user's project instead of the agent's /code folder.

workspace_root="${PLOINKY_CWD:-$PWD}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
secrets_tool="${script_dir}/encrypted-secrets.mjs"

# Ensure the Explorer agent runs in global mode so the workspace root is mounted
# into the container (not just the isolated agent workdir under ./agents/explorer).
#
# Ploinky stores enabled agents in JSON at .ploinky/agents.json.
# We update the record for this agent (and repo, if provided) to:
# - runMode: global
# - projectPath: <workspace_root>
agents_file="${workspace_root}/.ploinky/agents.json"
if [[ -f "$agents_file" ]]; then
    node - <<'NODE'
const fs = require('fs');
const path = require('path');

const workspaceRoot = process.env.PLOINKY_CWD || process.cwd();
const agentsFile = path.join(workspaceRoot, '.ploinky', 'agents.json');

const agentName = String(process.env.PLOINKY_AGENT_NAME || '').trim() || 'explorer';
const repoName = String(process.env.PLOINKY_REPO_NAME || '').trim();

let raw;
try {
    raw = fs.readFileSync(agentsFile, 'utf8');
} catch {
    process.exit(0);
}

let data;
try {
    data = JSON.parse(raw || '{}') || {};
} catch {
    process.exit(0);
}

let changed = false;
for (const [key, rec] of Object.entries(data)) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type !== 'agent') continue;
    if (String(rec.agentName || '').trim() !== agentName) continue;
    if (repoName && String(rec.repoName || '').trim() !== repoName) continue;
    // Don't rewrite aliased instances; only the primary agent should become global by default.
    if (rec.alias) continue;

    if (rec.runMode !== 'global') {
        rec.runMode = 'global';
        changed = true;
    }
    if (rec.projectPath !== workspaceRoot) {
        rec.projectPath = workspaceRoot;
        changed = true;
    }
    data[key] = rec;
}

if (changed) {
    try {
        fs.writeFileSync(agentsFile, JSON.stringify(data, null, 2));
    } catch {
        // ignore
    }
}
NODE
fi

mkdir -p .ploinky

# If already configured in secrets, don't overwrite.
if [[ -z "$(node "$secrets_tool" "$workspace_root" get "ASSISTOS_FS_ROOT")" ]]; then
    node "$secrets_tool" "$workspace_root" set "ASSISTOS_FS_ROOT" "$workspace_root"
fi

ensure_secret_var() {
    local name="$1"
    local value="$2"
    node "$secrets_tool" "$workspace_root" set "$name" "$value"
}

delete_secret_var() {
    local name="$1"
    node "$secrets_tool" "$workspace_root" delete "$name"
}

resolve_config_var() {
    local name="$1"
    node "$secrets_tool" "$workspace_root" resolve "$name"
}

derive_manifest_secret() {
    local name="$1"
node - <<'NODE' "$name"
const crypto = require('crypto');

const name = String(process.argv[2] || '').trim();
const derivedMasterHex = String(process.env.PLOINKY_DERIVED_MASTER_KEY || '').trim();
if (!name || !/^[A-Fa-f0-9]+$/.test(derivedMasterHex) || derivedMasterHex.length % 2 !== 0) {
    process.exit(0);
}

function normalizePart(value, fallback) {
    const normalized = String(value || '').trim().replace(/[^A-Za-z0-9_.:/-]/g, '_');
    return normalized || fallback;
}

const repoName = normalizePart(process.env.PLOINKY_REPO_NAME, 'unknown-repo');
const agentName = normalizePart(process.env.PLOINKY_AGENT_NAME, 'unknown-agent');
const secretName = normalizePart(name, '');
if (!secretName) {
    process.exit(0);
}

const info = Buffer.from([
    'ploinky/agent-secret',
    repoName,
    agentName,
    secretName,
    'v1',
].join('/'), 'utf8');
const secret = Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(derivedMasterHex, 'hex'),
    Buffer.alloc(0),
    info,
    32,
)).toString('hex');
process.stdout.write(secret);
NODE
}

resolve_onlyoffice_jwt_secret() {
    local derived
    derived="$(derive_manifest_secret "ONLYOFFICE_JWT_SECRET")"
    if [[ -n "$derived" ]]; then
        printf '%s' "$derived"
        return 0
    fi
    resolve_config_var "ONLYOFFICE_JWT_SECRET"
}

ensure_onlyoffice_service() {
    if ! command -v podman >/dev/null 2>&1; then
        return 0
    fi

    local workspace_name
    workspace_name="$(basename "$workspace_root")"
    local services_dir="${workspace_root}/.ploinky/services"
    local service_file="${services_dir}/onlyoffice.json"
    local container_name="ploinky_onlyoffice_${workspace_name}"
    local image="docker.io/onlyoffice/documentserver:latest"
    local record_host_port=""
    local record_container_name=""
    local should_recreate="0"
    local running_state="missing"
    local current_port=""
    local configured_public_url=""
    local configured_internal_url=""
    local configured_callback_base_url=""
    local configured_jwt_secret=""

    mkdir -p "$services_dir"

    if [[ -f "$service_file" ]]; then
        local record
        record="$(node - <<'NODE' "$service_file"
const fs = require('fs');
const file = process.argv[2];
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stdout.write([
    String(data.containerName || ''),
    String(data.hostPort || '')
  ].join('\n'));
} catch (_) {}
NODE
)"
        record_container_name="$(printf '%s\n' "$record" | sed -n '1p')"
        record_host_port="$(printf '%s\n' "$record" | sed -n '2p')"
        if [[ -n "$record_container_name" ]]; then
            container_name="$record_container_name"
        fi
    fi

    configured_public_url="$(resolve_config_var "ONLYOFFICE_PUBLIC_URL")"
    configured_internal_url="$(resolve_config_var "ONLYOFFICE_INTERNAL_URL")"
    configured_callback_base_url="$(resolve_config_var "ONLYOFFICE_CALLBACK_BASE_URL")"
    configured_jwt_secret="$(resolve_onlyoffice_jwt_secret)"

    local public_url=""
    local internal_url=""
    local callback_base_url=""
    local resolved_jwt_secret=""
    local manage_local_service="1"

    if [[ -n "$configured_public_url" ]]; then
        public_url="$configured_public_url"
        # Decide whether to manage the local container based on the internal URL
        # (falls back to public URL). This allows a public tunnel URL (e.g.
        # https://office.axiologic.dev) while still managing the local container
        # when the internal URL points to localhost.
        local check_url="${configured_internal_url:-$configured_public_url}"
        case "$check_url" in
            http://127.0.0.1:*|https://127.0.0.1:*|http://localhost:*|https://localhost:*|http://host.containers.internal:*|https://host.containers.internal:*)
                manage_local_service="1"
                ;;
            *)
                manage_local_service="0"
                ;;
        esac
    fi

    if [[ "$manage_local_service" == "0" ]]; then
        if [[ -n "$configured_public_url" ]]; then
            ensure_secret_var "ONLYOFFICE_PUBLIC_URL" "$configured_public_url"
        else
            delete_secret_var "ONLYOFFICE_PUBLIC_URL"
        fi
        if [[ -n "$configured_internal_url" ]]; then
            ensure_secret_var "ONLYOFFICE_INTERNAL_URL" "$configured_internal_url"
        else
            delete_secret_var "ONLYOFFICE_INTERNAL_URL"
        fi
        if [[ -n "$configured_callback_base_url" ]]; then
            ensure_secret_var "ONLYOFFICE_CALLBACK_BASE_URL" "$configured_callback_base_url"
        else
            delete_secret_var "ONLYOFFICE_CALLBACK_BASE_URL"
        fi
        if [[ -n "$configured_jwt_secret" ]]; then
            ensure_secret_var "ONLYOFFICE_JWT_SECRET" "$configured_jwt_secret"
        else
            delete_secret_var "ONLYOFFICE_JWT_SECRET"
        fi

        node - <<'NODE' "$service_file" "$configured_public_url" "${configured_callback_base_url:-}" "${record_container_name:-}" "$image"
const fs = require('fs');
const rawUrl = String(process.argv[3] || '').trim();
const callbackBaseUrl = String(process.argv[4] || '').trim();
const containerName = String(process.argv[5] || '').trim();
const image = String(process.argv[6] || '').trim();
let hostPort = 0;
try {
  const parsed = new URL(rawUrl);
  hostPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
} catch (_) {}
const payload = {
  containerName: containerName || 'external',
  image,
  hostPort,
  publicUrl: rawUrl,
  apiJsUrl: rawUrl ? `${rawUrl.replace(/\/+$/g, '')}/web-apps/apps/api/documents/api.js` : '',
  callbackBaseUrl,
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(process.argv[2], JSON.stringify(payload, null, 2));
NODE
        return 0
    fi

    if podman container exists "$container_name" 2>/dev/null; then
        running_state="$(podman inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || echo missing)"
        current_port="$(podman inspect -f '{{with (index .NetworkSettings.Ports "80/tcp")}}{{(index . 0).HostPort}}{{end}}' "$container_name" 2>/dev/null || true)"
    fi

    local preferred_port="${record_host_port:-8082}"
    # Derive preferred port from internal URL first (actual container port),
    # falling back to public URL. This avoids picking 443 when the public URL
    # is a tunnel (e.g. https://office.axiologic.dev).
    local port_source_url="${configured_internal_url:-$configured_public_url}"
    if [[ -n "$port_source_url" ]]; then
        local configured_port
        configured_port="$(node - <<'NODE' "$port_source_url"
try {
  const parsed = new URL(process.argv[2]);
  process.stdout.write(String(Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))));
} catch (_) {}
NODE
)"
        if [[ -n "$configured_port" && "$configured_port" != "80" && "$configured_port" != "443" ]]; then
            preferred_port="$configured_port"
        fi
    fi
    if [[ "$running_state" == "running" && -n "$current_port" ]]; then
        preferred_port="$current_port"
    fi

    local chosen_port
    chosen_port="$(node - <<'NODE' "$preferred_port" "$running_state" "$current_port"
const net = require('net');
const preferred = Number(process.argv[2] || 0);
const runningState = String(process.argv[3] || '');
const currentPort = Number(process.argv[4] || 0);

function isAvailable(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      resolve(false);
      return;
    }
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findRandomPort() {
  for (let i = 0; i < 100; i += 1) {
    const port = 10000 + Math.floor(Math.random() * 50000);
    if (await isAvailable(port)) {
      process.stdout.write(String(port));
      return;
    }
  }
  process.exit(1);
}

(async () => {
  if (runningState === 'running' && Number.isInteger(currentPort) && currentPort > 0) {
    process.stdout.write(String(currentPort));
    return;
  }
  if (await isAvailable(preferred)) {
    process.stdout.write(String(preferred));
    return;
  }
  await findRandomPort();
})().catch(() => process.exit(1));
NODE
)"
    if [[ -z "$chosen_port" ]]; then
        echo "[preinstall] explorer: failed to allocate OnlyOffice port" >&2
        return 1
    fi

    if [[ "$running_state" != "missing" ]]; then
        if [[ "$running_state" != "running" || "$current_port" != "$chosen_port" ]]; then
            should_recreate="1"
        fi
        # Recreate if the JWT secret changed (container env vs configured)
        if [[ "$should_recreate" == "0" && -n "$configured_jwt_secret" ]]; then
            local container_jwt
            container_jwt="$(podman inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container_name" 2>/dev/null | grep '^JWT_SECRET=' | cut -d= -f2)"
            if [[ -n "$container_jwt" && "$container_jwt" != "$configured_jwt_secret" ]]; then
                echo "[preinstall] explorer: OnlyOffice JWT secret changed, recreating container..." >&2
                should_recreate="1"
            fi
        fi
    else
        should_recreate="1"
    fi

    if [[ "$should_recreate" == "1" ]]; then
        podman rm -f "$container_name" >/dev/null 2>&1 || true
        echo "[preinstall] explorer: starting OnlyOffice on port ${chosen_port}..."
        podman run -d \
            --name "$container_name" \
            --restart unless-stopped \
            -p "127.0.0.1:${chosen_port}:80" \
            -e "JWT_ENABLED=true" \
            -e "JWT_SECRET=${configured_jwt_secret:-onlyoffice-local-dev-secret-change-me}" \
            "$image" >/dev/null
    fi

    public_url="${configured_public_url:-http://127.0.0.1:${chosen_port}}"
    internal_url="${configured_internal_url:-http://host.containers.internal:${chosen_port}}"
    callback_base_url="${configured_callback_base_url:-http://host.containers.internal:8080}"
    resolved_jwt_secret="${configured_jwt_secret:-onlyoffice-local-dev-secret-change-me}"

    ensure_secret_var "ONLYOFFICE_PUBLIC_URL" "$public_url"
    ensure_secret_var "ONLYOFFICE_INTERNAL_URL" "$internal_url"
    ensure_secret_var "ONLYOFFICE_CALLBACK_BASE_URL" "$callback_base_url"
    ensure_secret_var "ONLYOFFICE_JWT_SECRET" "$resolved_jwt_secret"

    node - <<'NODE' "$service_file" "$container_name" "$image" "$chosen_port" "$public_url" "$callback_base_url"
const fs = require('fs');
const file = process.argv[2];
const payload = {
  containerName: process.argv[3],
  image: process.argv[4],
  hostPort: Number(process.argv[5]),
  publicUrl: process.argv[6],
  apiJsUrl: `${process.argv[6]}/web-apps/apps/api/documents/api.js`,
  callbackBaseUrl: process.argv[7],
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(file, JSON.stringify(payload, null, 2));
NODE
}

ensure_onlyoffice_service

exit 0
