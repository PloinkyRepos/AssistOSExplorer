#!/bin/sh
set -eu

PERSISTO_DIR="${WORKSPACE_PATH:-/userpersisto-data}/Persisto"

if [ -d "$PERSISTO_DIR" ] && [ -d "$PERSISTO_DIR/node_modules" ]; then
  echo "Persisto already installed at $PERSISTO_DIR"
  exit 0
fi

if [ -d "$PERSISTO_DIR" ] && [ -f "$PERSISTO_DIR/package.json" ]; then
  echo "Persisto cloned; installing dependencies..."
  cd "$PERSISTO_DIR"
  npm install --omit=dev || {
    echo "WARNING: Persisto npm install failed; UserPersisto will use local fallback storage until Persisto is available."
    exit 0
  }
  exit 0
fi

mkdir -p "$(dirname "$PERSISTO_DIR")"
cd "$(dirname "$PERSISTO_DIR")"
git clone https://github.com/OpenDSU/Persisto.git
cd Persisto
npm install --omit=dev || {
  echo "WARNING: Persisto npm install failed; UserPersisto will use local fallback storage until Persisto is available."
  exit 0
}
echo "Persisto installed at $PERSISTO_DIR"
