#!/usr/bin/env bash
set -euo pipefail

# This hook runs on the HOST before container creation.
# Purpose: ensure ASSISTOS_FS_ROOT defaults to the current workspace directory
# so the Explorer exposes the user's project instead of the agent's /code folder.
#
# Note: prior versions of this hook also started a raw OnlyOffice Document Server
# sidecar (`ploinky_onlyoffice_<workspace>`). Document Server lifecycle now
# belongs to the Ploinky-managed `onlyOffice` agent (see
# `onlyOffice/manifest.json` and `onlyOffice/docs/specs/DS01-ploinky-agent-invariant.md`).
# Explorer no longer creates, recreates, or mutates that container.

workspace_root="${PLOINKY_WORKSPACE_ROOT:?PLOINKY_WORKSPACE_ROOT is required}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
explorer_root="$(cd "${script_dir}/../.." && pwd)"
secrets_tool="${script_dir}/encrypted-secrets.mjs"
axiface_url="${AXIFACE_REPO_URL:-https://github.com/AssistOS-AI/AxiFace.git}"
axiface_default_root="${explorer_root}/shared/vendor/axi-face"
axiface_root="${AXIFACE_REPO_PATH:-${axiface_default_root}}"

# Ensure the Explorer agent runs in global mode so the workspace root is mounted
# into the container (not just the isolated agent workdir under ./agents/explorer).
#
# Ploinky stores enabled agents in JSON at .ploinky/agents.json.
# We update the record for this agent (and repo, if provided) to:
# - runMode: global
# - projectPath: <workspace_root>
agents_file="${workspace_root}/.ploinky/agents.json"
mkdir -p "${workspace_root}/.ploinky"

if [[ -z "$(node "$secrets_tool" "$workspace_root" get "USERPERSISTO_RUNTIME_SECRET")" ]]; then
    node "$secrets_tool" "$workspace_root" set "USERPERSISTO_RUNTIME_SECRET" "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
fi

if [[ -z "$(node "$secrets_tool" "$workspace_root" get "USERPERSISTO_SETTINGS_SECRET")" ]]; then
    node "$secrets_tool" "$workspace_root" set "USERPERSISTO_SETTINGS_SECRET" "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
fi

if [[ -z "$(node "$secrets_tool" "$workspace_root" get "EMAIL_AGENT_SETTINGS_SECRET")" ]]; then
    node "$secrets_tool" "$workspace_root" set "EMAIL_AGENT_SETTINGS_SECRET" "$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")"
fi

node - <<'NODE'
const fs = require('fs');
const path = require('path');

const workspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT;
if (!workspaceRoot) process.exit(0);

const policyFile = path.join(workspaceRoot, '.ploinky', 'data', 'router-security', 'policy-state.json');
const now = new Date().toISOString();
const requiredTools = [
  ['emailAgent', 'email_send_auth_code', 'internal'],
  ['emailAgent', 'email_send_text', 'internal'],
  ['emailAgent', 'email_send_template', 'internal'],
  ['emailAgent', 'email_send_test', 'admin'],
  ['emailAgent', 'email_config_get', 'admin'],
  ['emailAgent', 'email_config_set', 'admin'],
  ['emailAgent', 'email_provider_status', 'admin'],
  ['userPersistoAgent', 'userpersisto_profile_get', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_authorize_capability', 'internal'],
  ['userPersistoAgent', 'userpersisto_user_list', 'admin'],
  ['userPersistoAgent', 'userpersisto_user_create', 'admin'],
  ['userPersistoAgent', 'userpersisto_user_update', 'admin'],
  ['userPersistoAgent', 'userpersisto_user_roles_update', 'admin'],
  ['userPersistoAgent', 'userpersisto_auth_password_login', 'internal'],
  ['userPersistoAgent', 'userpersisto_auth_password_set', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_auth_email_code_start', 'internal'],
  ['userPersistoAgent', 'userpersisto_auth_email_code_verify', 'internal'],
  ['userPersistoAgent', 'userpersisto_passkey_registration_options', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_passkey_registration_verify', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_passkey_login_options', 'internal'],
  ['userPersistoAgent', 'userpersisto_passkey_login_verify', 'internal'],
  ['userPersistoAgent', 'userpersisto_totp_setup_start', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_totp_setup_verify', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_totp_login_verify', 'internal'],
  ['userPersistoAgent', 'userpersisto_credits_balance', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_credits_ledger', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_credits_grant', 'admin'],
  ['userPersistoAgent', 'userpersisto_credits_refund', 'admin'],
  ['userPersistoAgent', 'userpersisto_credits_reserve', 'internal'],
  ['userPersistoAgent', 'userpersisto_credits_commit', 'internal'],
  ['userPersistoAgent', 'userpersisto_credits_release', 'internal'],
  ['userPersistoAgent', 'userpersisto_billing_checkout_create', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_billing_subscription_get', 'authenticated'],
  ['userPersistoAgent', 'userpersisto_billing_stripe_webhook_process', 'internal'],
  ['userPersistoAgent', 'userpersisto_billing_events_list', 'admin'],
  ['userPersistoAgent', 'userpersisto_config_get', 'admin'],
  ['userPersistoAgent', 'userpersisto_config_set', 'admin'],
  ['userPersistoAgent', 'userpersisto_audit_events_list', 'admin']
];

let state = { schema: 'router-policy', httpRoutes: [], mcpTools: [] };
try {
  if (fs.existsSync(policyFile)) {
    state = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  }
} catch {
  process.exit(0);
}
if (!state || state.schema !== 'router-policy' || !Array.isArray(state.httpRoutes) || !Array.isArray(state.mcpTools)) {
  process.exit(0);
}

let changed = false;
for (const [agent, tool, access] of requiredTools) {
  let entry = state.mcpTools.find((item) => item.agent === agent && item.tool === tool);
  if (entry) {
    if (entry.access !== access || entry.enabled === false) {
      entry.access = access;
      entry.enabled = true;
      entry.updatedAt = now;
      entry.updatedBy = 'explorer:preinstall';
      changed = true;
    }
    continue;
  }
  state.mcpTools.push({
    agent,
    tool,
    access,
    source: 'explorer:preinstall',
    enabled: true,
    createdAt: now,
    createdBy: 'explorer:preinstall',
    updatedAt: now,
    updatedBy: 'explorer:preinstall'
  });
  changed = true;
}

if (changed) {
  fs.mkdirSync(path.dirname(policyFile), { recursive: true });
  const tmpFile = `${policyFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmpFile, policyFile);
}
NODE

if [[ -f "$agents_file" ]]; then
    node - <<'NODE'
const fs = require('fs');
const path = require('path');

const workspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT;
if (!workspaceRoot) process.exit(1);
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
    const nextAuth = { mode: 'sso' };
    if (JSON.stringify(rec.auth || {}) !== JSON.stringify(nextAuth)) {
        rec.auth = nextAuth;
        changed = true;
    }
    data[key] = rec;
}

data._config = data._config && typeof data._config === 'object' ? data._config : {};
const nextSso = {
    ...(data._config.sso && typeof data._config.sso === 'object' ? data._config.sso : {}),
    enabled: true,
    providerAgent: 'AchillesIDE/userPersistoAgent',
    providerAgentShort: 'userPersistoAgent',
    providerConfig: {
        ...(
            data._config.sso &&
            typeof data._config.sso === 'object' &&
            data._config.sso.providerConfig &&
            typeof data._config.sso.providerConfig === 'object'
                ? data._config.sso.providerConfig
                : {}
        ),
        routerBaseUrl: `http://localhost:${process.env.PLOINKY_ROUTER_PORT || process.env.ROUTER_PORT || '8080'}`,
        loginPath: '/public-services/userpersisto/auth/login',
        runtimePath: '/public-services/userpersisto/runtime',
        runtimeSecretName: 'USERPERSISTO_RUNTIME_SECRET'
    }
};
if (JSON.stringify(data._config.sso || {}) !== JSON.stringify(nextSso)) {
    data._config.sso = nextSso;
    changed = true;
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

# If already configured in secrets, don't overwrite.
if [[ -z "$(node "$secrets_tool" "$workspace_root" get "ASSISTOS_FS_ROOT")" ]]; then
    node "$secrets_tool" "$workspace_root" set "ASSISTOS_FS_ROOT" "$workspace_root"
fi

if [[ ! -f "${axiface_root}/src/axi-face.mjs" ]]; then
    if [[ -n "${AXIFACE_REPO_PATH:-}" ]]; then
        echo "[preinstall] AXIFACE_REPO_PATH does not contain src/axi-face.mjs: ${AXIFACE_REPO_PATH}" >&2
        exit 1
    fi
    mkdir -p "$(dirname "${axiface_root}")"
    git clone "${axiface_url}" "${axiface_root}"
fi

if [[ ! -f "${axiface_root}/src/axi-face.mjs" ]]; then
    echo "[preinstall] AxiFace asset repository is missing src/axi-face.mjs: ${axiface_root}" >&2
    exit 1
fi

if [[ ! -d "${axiface_root}/packs" ]]; then
    echo "[preinstall] AxiFace asset repository is missing packs/: ${axiface_root}" >&2
    exit 1
fi

if find "${axiface_root}/src" "${axiface_root}/packs" -type l -print -quit | grep -q .; then
    echo "[preinstall] AxiFace public assets must not contain symlinks: ${axiface_root}" >&2
    exit 1
fi

for pack_dir in "${axiface_root}"/packs/*; do
    if [[ -d "${pack_dir}" ]]; then
        pack_name="$(basename "${pack_dir}")"
        if [[ ! "${pack_name}" =~ ^[A-Za-z0-9._-]+$ ]]; then
            echo "[preinstall] Invalid AxiFace pack directory name: ${pack_name}" >&2
            exit 1
        fi
    fi
done

node --input-type=module - "${axiface_root}" "${axiface_root}/packs/index.json" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [, , axifaceRoot, outputPath] = process.argv;
const packsRoot = path.join(axifaceRoot, 'packs');
const packs = [];

for (const name of fs.readdirSync(packsRoot).sort()) {
    const manifestPath = path.join(packsRoot, name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    packs.push({
        ...manifest,
        id: manifest.id || name,
        name: manifest.name || name,
        description: manifest.description || '',
        manifestSrc: `/explorer/shared/vendor/axi-face/packs/${name}/manifest.json`
    });
}

fs.writeFileSync(outputPath, `${JSON.stringify({ packs }, null, 2)}\n`);
NODE

exit 0
