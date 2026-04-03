#!/bin/sh
TOOL_NAME="${1:-${TOOL_NAME:-}}"
export TOOL_NAME
node "$(cd "$(dirname "$0")" && pwd)/git_tool.mjs"
