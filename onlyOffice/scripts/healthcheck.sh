#!/usr/bin/env bash
set -euo pipefail

curl -fsS --max-time 2 http://127.0.0.1:80/web-apps/apps/api/documents/api.js >/dev/null
curl -sS --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:7000/__ready | grep -qx '404'
curl -sS --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:9100/__ready | grep -qx '404'

assert_loopback_owner() {
  label="$1"
  port="$2"
  owner_pattern="$3"
  required="${4:-true}"
  listeners="$(ss -H -lntp "sport = :${port}" 2>/dev/null || true)"

  if [ -z "$listeners" ]; then
    if [ "$required" = true ]; then
      echo "$label listener ${port}/tcp is absent." >&2
      exit 1
    fi
    return 0
  fi
  if printf '%s\n' "$listeners" | awk '$4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/ { bad=1 } END { exit(bad ? 0 : 1) }'; then
    echo "$label listener ${port}/tcp is not process-local: $listeners" >&2
    exit 1
  fi
  if ! printf '%s\n' "$listeners" | grep -Eq "users:\(\(\"(${owner_pattern})\""; then
    echo "$label listener ${port}/tcp has an unexpected socket owner: $listeners" >&2
    exit 1
  fi
}

assert_no_wildcard_support_listener() {
  label="$1"
  port="$2"
  listeners="$(ss -H -lntp "sport = :${port}" 2>/dev/null || true)"
  if [ -n "$listeners" ] && printf '%s\n' "$listeners" | awk '$4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/ { bad=1 } END { exit(bad ? 0 : 1) }'; then
    echo "$label ${port}/tcp is wildcard-bound by the pinned DocumentServer package; no supported bind-host setting exists, so v5 route activation is blocked: $listeners" >&2
    exit 1
  fi
}

for port in 7000 8080 9100; do
  ss -H -lnt "sport = :${port}" | grep -q . || {
    echo "OnlyOffice listener ${port}/tcp is absent." >&2
    exit 1
  }
done

for port in 7000 8080; do
  ss -H -lnt "sport = :${port}" | grep -Eq '0\.0\.0\.0|\*|::' || {
    echo "OnlyOffice routed listener ${port}/tcp is not reachable from its managed target." >&2
    exit 1
  }
done

ss -H -lnt "sport = :9100" | grep -Eq '127\.0\.0\.1|\[::1\]' || {
  echo 'OnlyOffice storage/callback listener must be loopback-only.' >&2
  exit 1
}

assert_loopback_owner 'OnlyOffice nginx transport' 80 nginx
assert_loopback_owner 'OnlyOffice PostgreSQL' 5432 postgres
assert_loopback_owner 'OnlyOffice RabbitMQ AMQP' 5672 'beam\.smp'
assert_loopback_owner 'OnlyOffice Erlang port mapper' 4369 epmd
assert_loopback_owner 'OnlyOffice RabbitMQ distribution' 25672 'beam\.smp'
assert_loopback_owner 'OnlyOffice Redis' 6379 redis-server false

# DocumentServer 9.3.1's embedded DocService binary exposes no supported bind
# host setting. The pinned, exact-port build-time interposer must force its
# wildcard port 8000 bind onto process loopback.
assert_loopback_owner 'OnlyOffice DocService' 8000 docservice
assert_no_wildcard_support_listener 'OnlyOffice AdminPanel' 9000
