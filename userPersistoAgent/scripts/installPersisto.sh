#!/bin/sh
set -eu

PERSISTO_DIR="${WORKSPACE_PATH:-/userpersisto-data}/Persisto"

ensure_achilles_utils() {
  ACHILLES_UTILS_DIR="$PERSISTO_DIR/src/audit/achillesUtils"
  if [ -d "$ACHILLES_UTILS_DIR" ]; then
    return 0
  fi
  if [ ! -d "$PERSISTO_DIR/src/audit" ]; then
    echo "ERROR: Persisto audit directory is missing; UserPersisto requires Persisto storage." >&2
    exit 1
  fi
  git clone https://github.com/AssistOS-AI/achillesUtils.git "$ACHILLES_UTILS_DIR" || {
    echo "ERROR: Persisto achillesUtils install failed; UserPersisto requires Persisto storage." >&2
    exit 1
  }
}

if [ -d "$PERSISTO_DIR" ] && [ -f "$PERSISTO_DIR/src/persistoServer.cjs" ]; then
  echo "Persisto already installed at $PERSISTO_DIR"
  ensure_achilles_utils
  exit 0
fi

if [ -d "$PERSISTO_DIR" ] && [ -f "$PERSISTO_DIR/package.json" ]; then
  echo "Persisto cloned; verifying required files..."
  ensure_achilles_utils
  exit 0
fi

mkdir -p "$(dirname "$PERSISTO_DIR")"
cd "$(dirname "$PERSISTO_DIR")"
git clone https://github.com/OpenDSU/Persisto.git
ensure_achilles_utils
echo "Persisto installed at $PERSISTO_DIR"
