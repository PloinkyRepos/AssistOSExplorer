#!/bin/sh
set -e

echo "Installing soplangAgent dependencies..."

if [ "${PLOINKY_RUNTIME:-}" = "bwrap" ]; then
    echo "Running under bwrap — skipping apt-get (using host packages)"
    # git is required; ffmpeg is optional (only needed for multimedia processing)
    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git not found on host"
        exit 1
    fi
    if ! command -v ffmpeg >/dev/null 2>&1; then
        echo "WARNING: ffmpeg not found on host (needed for multimedia features)"
        echo "  sudo apt install -y ffmpeg"
    fi
else
    apt-get update && apt-get install -y git ffmpeg
fi

echo "soplangAgent dependencies OK"
