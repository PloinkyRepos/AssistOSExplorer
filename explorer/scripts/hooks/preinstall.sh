#!/usr/bin/env bash
set -euo pipefail

# This hook runs on the HOST before container creation.
# Purpose: ensure ASSISTOS_FS_ROOT defaults to the current workspace directory
# so the Explorer exposes the user's project instead of the agent's /code folder.

workspace_root="${PLOINKY_CWD:-$PWD}"

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
secrets_file=".ploinky/.secrets"
touch "$secrets_file"

# If already configured in secrets, don't overwrite.
if grep -q '^ASSISTOS_FS_ROOT=' "$secrets_file"; then
    :
else
    {
        echo
        echo "ASSISTOS_FS_ROOT=${workspace_root}"
    } >> "$secrets_file"
fi

ensure_secret_var() {
    local name="$1"
    local value="$2"
    if grep -q "^${name}=" "$secrets_file"; then
        sed -i.bak "s#^${name}=.*#${name}=${value}#g" "$secrets_file" && rm -f "${secrets_file}.bak"
    else
        echo "${name}=${value}" >> "$secrets_file"
    fi
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
    local resolved_jwt_secret="${ONLYOFFICE_JWT_SECRET:-onlyoffice-local-dev-secret-change-me}"
    local callback_base_url="${ONLYOFFICE_CALLBACK_BASE_URL:-http://host.containers.internal:8080}"
    local record_host_port=""
    local record_container_name=""
    local should_recreate="0"
    local running_state="missing"
    local current_port=""

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

    if podman container exists "$container_name" 2>/dev/null; then
        running_state="$(podman inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || echo missing)"
        current_port="$(podman inspect -f '{{with (index .NetworkSettings.Ports "80/tcp")}}{{(index . 0).HostPort}}{{end}}' "$container_name" 2>/dev/null || true)"
    fi

    local preferred_port="${record_host_port:-8082}"
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
            -e "JWT_SECRET=${resolved_jwt_secret}" \
            "$image" >/dev/null
    fi

    local public_url="http://127.0.0.1:${chosen_port}"
    local internal_url="http://host.containers.internal:${chosen_port}"
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
