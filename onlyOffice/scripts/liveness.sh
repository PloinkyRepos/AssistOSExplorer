#!/usr/bin/env bash
set -euo pipefail

expect_status() {
  local url="$1"
  local expected="$2"
  local observed
  observed="$(
    curl --noproxy '*' -sS --connect-timeout 1 --max-time 2 \
      -o /dev/null -w '%{http_code}' "$url"
  )"
  if [[ "$observed" != "$expected" ]]; then
    printf 'OnlyOffice liveness expected HTTP %s from %s, received %s.\n' \
      "$expected" "$url" "${observed:-<empty>}" >&2
    return 1
  fi
}

curl --noproxy '*' -fsS --connect-timeout 1 --max-time 2 \
  http://127.0.0.1:80/healthcheck \
  >/dev/null
expect_status http://127.0.0.1:7000/__ploinky_liveness 404
expect_status http://127.0.0.1:8080/healthcheck 404
expect_status http://127.0.0.1:9100/__ploinky_liveness 404
