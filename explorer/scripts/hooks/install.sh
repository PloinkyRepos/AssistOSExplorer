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

apt-get update && apt-get install -y git

echo ""
echo "============================================"
echo "Explorer installation complete!"
echo "============================================"
