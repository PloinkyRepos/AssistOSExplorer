#!/usr/bin/env bash
set -euo pipefail

# This hook runs on the HOST before container creation.
# Purpose: ensure ASSISTOS_FS_ROOT defaults to the current workspace directory
# so the Explorer exposes the user's project instead of the agent's /code folder.

if [[ -n "${ASSISTOS_FS_ROOT:-}" ]]; then
    exit 0
fi

workspace_root="${PLOINKY_CWD:-$PWD}"

# Ensure the Explorer agent runs in global mode so the workspace root is mounted
# into the container (not just the isolated agent workdir under ./agents/explorer).
#
# Ploinky stores enabled agents in JSON at .ploinky/agents (no extension).
# We update the record for this agent (and repo, if provided) to:
# - runMode: global
# - projectPath: <workspace_root>
agents_file="${workspace_root}/.ploinky/agents"
if [[ -f "$agents_file" ]]; then
    node - <<'NODE'
const fs = require('fs');
const path = require('path');

const workspaceRoot = process.env.PLOINKY_CWD || process.cwd();
const agentsFile = path.join(workspaceRoot, '.ploinky', 'agents');

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
    exit 0
fi

{
    echo
    echo "ASSISTOS_FS_ROOT=${workspace_root}"
} >> "$secrets_file"

exit 0
