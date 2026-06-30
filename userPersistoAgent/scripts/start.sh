#!/bin/sh
set -eu

PERSISTO_DIR="${WORKSPACE_PATH:-/userpersisto-data}/Persisto"
if [ ! -d "$PERSISTO_DIR" ] && [ -d "/code/Persisto" ]; then
  PERSISTO_DIR="/code/Persisto"
fi

export PERSISTO_PORT="${PERSISTO_PORT:-3000}"
export PERSISTO_HOST="${PERSISTO_HOST:-localhost}"
export PERSISTO_URL="${PERSISTO_URL:-http://$PERSISTO_HOST:$PERSISTO_PORT}"

PERSISTO_DATA_DIR="${WORKSPACE_PATH:-/userpersisto-data}/persisto-data"
export PERSISTENCE_FOLDER="${PERSISTENCE_FOLDER:-$PERSISTO_DATA_DIR/work_space_data}"
export LOGS_FOLDER="${LOGS_FOLDER:-$PERSISTO_DATA_DIR/logs}"
export AUDIT_FOLDER="${AUDIT_FOLDER:-$PERSISTO_DATA_DIR/audit}"

mkdir -p "$PERSISTENCE_FOLDER" "$LOGS_FOLDER" "$AUDIT_FOLDER" /userpersisto-data

if [ -f "$PERSISTO_DIR/src/persistoServer.cjs" ]; then
  node "$PERSISTO_DIR/src/persistoServer.cjs" &
  echo "Waiting for internal Persisto on $PERSISTO_HOST:$PERSISTO_PORT..."
  i=0
  until node -e "fetch(process.env.PERSISTO_URL).then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 30 ]; then
      echo "Persisto did not become ready; UserPersisto will use local fallback storage until it is available."
      break
    fi
    sleep 1
  done
else
  echo "Persisto server not installed; UserPersisto will use local fallback storage."
fi

export USERPERSISTO_AGENTSERVER_PORT="${USERPERSISTO_AGENTSERVER_PORT:-7001}"

node /code/main.mjs &
PORT="$USERPERSISTO_AGENTSERVER_PORT" sh "${PLOINKY_AGENT_LIB_DIR:-/Agent}/server/AgentServer.sh" &
exec node /code/service/index.mjs
