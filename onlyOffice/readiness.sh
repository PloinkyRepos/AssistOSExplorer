#!/bin/sh
# Runs inside the OnlyOfficeAgent container as Ploinky's blocking readiness
# probe. The control listener alone is not sufficient: it starts before the
# bundled Document Server has brought up RabbitMQ, supervisor, and Nginx.
set -u

HOST="127.0.0.1"
CONTROL_PORT="${ONLYOFFICE_CONTROL_PORT:-7000}"
EDITOR_PORT="${ONLYOFFICE_EDITOR_PORT:-8080}"
API_PATH="/web-apps/apps/api/documents/api.js"

log() {
    printf '[onlyOffice readiness] %s\n' "$1"
}

if ! command -v nc >/dev/null 2>&1; then
    log "ERROR: pinned image is missing nc."
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    log "ERROR: pinned image is missing curl."
    exit 1
fi

if ! nc -z -w 2 "$HOST" "$CONTROL_PORT" >/dev/null 2>&1; then
    log "ERROR: control listener is not reachable on ${HOST}:${CONTROL_PORT}."
    exit 1
fi

api_status="$(curl --fail --silent --show-error --max-time 4 \
    --output /dev/null --write-out '%{http_code}' \
    "http://${HOST}:${EDITOR_PORT}${API_PATH}" 2>/dev/null)"
curl_status="$?"
if [ "$curl_status" -ne 0 ] || [ "$api_status" != "200" ]; then
    log "ERROR: editor proxy cannot serve the Document Server API."
    exit 1
fi

log "ready"
