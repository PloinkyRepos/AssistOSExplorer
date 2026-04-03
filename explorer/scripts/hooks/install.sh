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
echo "Explorer runtime install hook"
echo "============================================"
echo "No additional OS packages required at container startup."
