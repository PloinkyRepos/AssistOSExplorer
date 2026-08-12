#!/bin/sh
exec node "$(cd "$(dirname "$0")" && pwd)/workspace_monitor_tool.mjs"
