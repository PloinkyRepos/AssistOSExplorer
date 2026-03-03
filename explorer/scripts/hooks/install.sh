#!/bin/sh
# ============================================================================
# install.sh - Explorer Container Installation Script
# ============================================================================
# Runs inside the container during ploinky agent installation.
# Installs OS-level dependencies only. Git repositories (like gitTest) are
# managed by ploinky via `ploinky add repo` and live under .ploinky/repos/.
# ============================================================================
set -e

echo "============================================"
echo "Installing explorer dependencies..."
echo "============================================"

if [ "${PLOINKY_RUNTIME:-}" = "bwrap" ]; then
    echo "Running under bwrap — skipping apt-get (using host packages)"
    command -v git >/dev/null || { echo "ERROR: git not found on host"; exit 1; }
else
    apt-get update && apt-get install -y git
fi

echo ""
echo "============================================"
echo "Explorer installation complete!"
echo "============================================"
