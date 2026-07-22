#!/usr/bin/env bash
set -euo pipefail

workspace_root="${PLOINKY_WORKSPACE_ROOT:?PLOINKY_WORKSPACE_ROOT is required}"
data_root="${workspace_root}/.ploinky/data/onlyOffice"

mkdir -p \
  "${data_root}/log" \
  "${data_root}/data" \
  "${data_root}/lib" \
  "${data_root}/postgresql" \
  "${data_root}/rabbitmq" \
  "${data_root}/redis"

# Runtime contract v5 is a hard cut. This hook intentionally does not inspect,
# import, stop, delete, or rewrite any legacy host-side OnlyOffice deployment.
