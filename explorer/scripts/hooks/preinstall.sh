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

mkdir -p "${workspace_root}/.ploinky"

# If already configured in secrets, don't overwrite.
if [[ -z "$(node "$secrets_tool" "$workspace_root" get "ASSISTOS_FS_ROOT")" ]]; then
    node "$secrets_tool" "$workspace_root" set "ASSISTOS_FS_ROOT" "$workspace_root"
fi

exit 0
