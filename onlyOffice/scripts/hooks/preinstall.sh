#!/usr/bin/env bash
set -euo pipefail

workspace_root="${PLOINKY_WORKSPACE_ROOT:?PLOINKY_WORKSPACE_ROOT is required}"
data_root="${workspace_root}/.ploinky/data/onlyOffice"
onlyoffice_version="${ONLYOFFICE_VERSION:-9.3.1}"
editor_port="${ONLYOFFICE_EDITOR_PORT:-8080}"

if [[ ! "$onlyoffice_version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "[onlyOffice/preinstall] invalid ONLYOFFICE_VERSION tag '${onlyoffice_version}'" >&2
    exit 1
fi

if [[ ! "$editor_port" =~ ^[0-9]+$ ]] || (( editor_port < 1 || editor_port > 65535 )); then
    echo "[onlyOffice/preinstall] invalid ONLYOFFICE_EDITOR_PORT '${editor_port}'" >&2
    exit 1
fi

mkdir -p \
    "${data_root}/log" \
    "${data_root}/data" \
    "${data_root}/lib"

container_runtime=""
if command -v podman >/dev/null 2>&1; then
    container_runtime="podman"
elif command -v docker >/dev/null 2>&1; then
    container_runtime="docker"
fi

if [ -n "$container_runtime" ]; then
    # One-time migration: stop and remove the legacy raw sidecar that was started
    # by the Explorer host preinstall hook before the OnlyOffice agent existed.
    # The legacy container holds host port 8082, so leaving it running would block
    # the Ploinky-managed agent from binding the same port. The Explorer hook no
    # longer creates this sidecar, but a previously-deployed workspace may still
    # have one.
    workspace_name="$(basename "$workspace_root")"
    legacy_container="ploinky_onlyoffice_${workspace_name}"
    if "$container_runtime" container exists "$legacy_container" 2>/dev/null; then
        echo "[onlyOffice/preinstall] removing legacy raw sidecar '${legacy_container}' (Ploinky-managed agent now owns the Document Server)" >&2
        if ! "$container_runtime" rm -f "$legacy_container" >/dev/null 2>&1; then
            echo "[onlyOffice/preinstall] failed to remove legacy raw sidecar '${legacy_container}'" >&2
            exit 1
        fi
        if "$container_runtime" container exists "$legacy_container" 2>/dev/null; then
            echo "[onlyOffice/preinstall] legacy raw sidecar '${legacy_container}' still exists after removal" >&2
            exit 1
        fi
    fi
fi

# Default the Explorer-facing editor URL to Ploinky's authenticated same-origin
# port convention. Explicit production URLs remain untouched; the old local host
# ports are migrated because agent listeners are no longer host-published.

set_default_var() {
    local name="$1"
    local default_value="$2"
    shift 2
    local current_value=""
    local echo_output=""
    if [ -z "$default_value" ]; then
        return 0
    fi
    # `ploinky echo NAME` prints `NAME=` for unset vars, so parse the value.
    # Empty is invalid for these URLs and should be treated as unset.
    echo_output="$(ploinky echo "$name" 2>/dev/null || true)"
    current_value="$(printf '%s\n' "$echo_output" | awk -v key="$name" '
        index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
        END { print value }
    ')"
    if [ -z "$current_value" ]; then
        if ! ploinky var "$name" "$default_value" >/dev/null 2>&1; then
            echo "[onlyOffice/preinstall] warning: could not set default ${name}" >&2
        fi
        return 0
    fi

    local legacy_value=""
    for legacy_value in "$@"; do
        if [ "$current_value" = "$legacy_value" ]; then
            if ! ploinky var "$name" "$default_value" >/dev/null 2>&1; then
                echo "[onlyOffice/preinstall] warning: could not migrate legacy default ${name}" >&2
            fi
            return 0
        fi
    done
}

set_default_var ONLYOFFICE_PUBLIC_URL "/base-agent-additional-server/onlyOffice/${editor_port}" "http://127.0.0.1:8082" "http://127.0.0.1:18082"
set_default_var ONLYOFFICE_INTERNAL_URL "http://127.0.0.1:80" "http://host.containers.internal:8082" "http://host.containers.internal:18082"
set_default_var ONLYOFFICE_CALLBACK_BASE_URL "http://host.containers.internal:8080"
