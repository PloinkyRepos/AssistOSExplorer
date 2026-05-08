#!/usr/bin/env bash
set -euo pipefail

workspace_root="${PLOINKY_CWD:-$PWD}"
profile="${PLOINKY_PROFILE:-default}"
data_root="${workspace_root}/.ploinky/data/onlyOffice"
onlyoffice_version="${ONLYOFFICE_VERSION:-9.3.1}"
onlyoffice_image="docker.io/onlyoffice/documentserver:${onlyoffice_version}"

if [[ ! "$onlyoffice_version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "[onlyOffice/preinstall] invalid ONLYOFFICE_VERSION tag '${onlyoffice_version}'" >&2
    exit 1
fi

mkdir -p \
    "${data_root}/log" \
    "${data_root}/data" \
    "${data_root}/lib" \
    "${data_root}/postgresql" \
    "${data_root}/rabbitmq" \
    "${data_root}/redis"

if command -v podman >/dev/null 2>&1; then
    # Pull before removing the legacy sidecar so a bad tag or registry outage
    # fails without deleting the currently working Document Server.
    if ! podman image exists "$onlyoffice_image" >/dev/null 2>&1; then
        echo "[onlyOffice/preinstall] pulling ${onlyoffice_image} before legacy sidecar migration" >&2
        podman pull "$onlyoffice_image" >/dev/null
    fi

    # One-time migration: stop and remove the legacy raw sidecar that was started
    # by the Explorer host preinstall hook before the OnlyOffice agent existed.
    # The legacy container holds host port 8082, so leaving it running would block
    # the Ploinky-managed agent from binding the same port. The Explorer hook no
    # longer creates this sidecar, but a previously-deployed workspace may still
    # have one.
    workspace_name="$(basename "$workspace_root")"
    legacy_container="ploinky_onlyoffice_${workspace_name}"
    if podman container exists "$legacy_container" 2>/dev/null; then
        echo "[onlyOffice/preinstall] removing legacy raw sidecar '${legacy_container}' (Ploinky-managed agent now owns the Document Server)" >&2
        if ! podman rm -f "$legacy_container" >/dev/null 2>&1; then
            echo "[onlyOffice/preinstall] failed to remove legacy raw sidecar '${legacy_container}'" >&2
            exit 1
        fi
        if podman container exists "$legacy_container" 2>/dev/null; then
            echo "[onlyOffice/preinstall] legacy raw sidecar '${legacy_container}' still exists after removal" >&2
            exit 1
        fi
    fi
fi

# Default the Explorer-facing OnlyOffice URLs so local-dev workspaces have working
# values without requiring the deploy workflow's ploinky vars. Production runs
# with these vars set explicitly by the deploy workflow, so the existing values
# remain untouched.
case "$profile" in
    dev) host_port=18082 ;;
    *)   host_port=8082  ;;
esac

set_default_var() {
    local name="$1"
    local default_value="$2"
    if [ -z "$default_value" ]; then
        return 0
    fi
    # ploinky echo prints the resolved value or errors if the var is unset.
    if ! ploinky echo "$name" >/dev/null 2>&1; then
        if ! ploinky var "$name" "$default_value" >/dev/null 2>&1; then
            echo "[onlyOffice/preinstall] warning: could not set default ${name}" >&2
        fi
    fi
}

set_default_var ONLYOFFICE_PUBLIC_URL "http://127.0.0.1:${host_port}"
set_default_var ONLYOFFICE_INTERNAL_URL "http://host.containers.internal:${host_port}"
set_default_var ONLYOFFICE_CALLBACK_BASE_URL "http://host.containers.internal:8080"
