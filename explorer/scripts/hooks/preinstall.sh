#!/usr/bin/env bash
set -euo pipefail

# This hook runs on the HOST before container creation.
# Purpose: ensure ASSISTOS_FS_ROOT defaults to the current workspace directory
# so the Explorer exposes the user's project instead of the agent's /code folder.

if [[ -n "${ASSISTOS_FS_ROOT:-}" ]]; then
    exit 0
fi

workspace_root="${PLOINKY_CWD:-$PWD}"

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
