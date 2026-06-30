#!/bin/sh
set -eu
mkdir -p /emailagent-data
node /code/main.mjs &
exec sh "${PLOINKY_AGENT_LIB_DIR:-/Agent}/server/AgentServer.sh"
