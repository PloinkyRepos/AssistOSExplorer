#!/bin/sh
# ============================================================================
# install.sh - Explorer Container Installation Script
# ============================================================================
# Runs inside the container during ploinky agent installation.
# Installs OS-level dependencies and clones the gitTest repository into the
# ASSISTOS_FS_ROOT so it is visible in the file explorer UI.
# ============================================================================
set -e

echo "============================================"
echo "Installing explorer dependencies..."
echo "============================================"

# ============================================================================
# OS packages
# ============================================================================
apt-get update && apt-get install -y git

# ============================================================================
# Clone gitTest repository
# ============================================================================
# ASSISTOS_FS_ROOT is the workspace root exposed to the file explorer.
# gitTest should live inside it so users can browse and commit via the UI.
FS_ROOT="${ASSISTOS_FS_ROOT:-/code}"
GITTEST_DIR="${FS_ROOT}/gitTest"

if [ -d "$GITTEST_DIR/.git" ]; then
    echo "gitTest repo already exists, pulling latest..."
    cd "$GITTEST_DIR"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
    cd /code
else
    echo "Cloning gitTest repository into $GITTEST_DIR..."
    git clone https://github.com/AssistosTest/gitTest.git "$GITTEST_DIR" || {
        echo "Warning: Failed to clone gitTest repository"
        echo "The repo may be private or unavailable."
    }
fi

if [ -d "$GITTEST_DIR" ]; then
    echo "gitTest repo ready at $GITTEST_DIR"
else
    echo "Warning: gitTest repo not available"
fi

echo ""
echo "============================================"
echo "Explorer installation complete!"
echo "============================================"
