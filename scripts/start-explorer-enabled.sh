#!/bin/sh

set -e

if [ ! -d ".ploinky" ]; then
  echo "Error: run from the workspace root (missing .ploinky directory)." >&2
  exit 1
fi

PORT_ARG="$1"

has_static_config() {
  node -e "try{const fs=require('fs');const files=['.ploinky/agents.json','.ploinky/agents'];for(const file of files){if(!fs.existsSync(file)) continue; const d=JSON.parse(fs.readFileSync(file,'utf8')); process.exit(d&&d._config&&d._config.static&&d._config.static.agent?0:1)}process.exit(1)}catch(e){process.exit(1)}"
}

if [ -n "$PORT_ARG" ]; then
  exec env PLOINKY_SKIP_EXPLORER_START_SCRIPT=1 ploinky start explorer "$PORT_ARG"
fi

if has_static_config; then
  exec env PLOINKY_SKIP_EXPLORER_START_SCRIPT=1 ploinky start
fi

exec env PLOINKY_SKIP_EXPLORER_START_SCRIPT=1 ploinky start explorer 8080
