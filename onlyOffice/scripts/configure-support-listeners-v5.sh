#!/usr/bin/env bash
set -euo pipefail

postgresql_config_glob="${ONLYOFFICE_POSTGRESQL_CONFIG_GLOB:-/etc/postgresql/*/*/postgresql.conf}"
postgresql_socket_dir="${ONLYOFFICE_POSTGRESQL_SOCKET_DIR:-/dev/shm/postgresql}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
node_bin="${ONLYOFFICE_NODE_BIN:-/usr/local/bin/node}"
support_runtime_preparer="${ONLYOFFICE_SUPPORT_RUNTIME_PREPARER:-${script_dir}/prepare-support-service-runtime.mjs}"
redis_config_file="${ONLYOFFICE_REDIS_CONFIG_FILE:-/etc/redis/redis.conf}"
rabbitmq_config_file="${ONLYOFFICE_RABBITMQ_CONFIG_FILE:-/etc/rabbitmq/rabbitmq.conf}"
rabbitmq_env_file="${ONLYOFFICE_RABBITMQ_ENV_FILE:-/etc/rabbitmq/rabbitmq-env.conf}"

if [ ! -x "$node_bin" ]; then
  echo "OnlyOffice Node.js runtime is missing or not executable: $node_bin" >&2
  exit 1
fi
if [ ! -f "$support_runtime_preparer" ]; then
  echo "OnlyOffice support-service runtime preparer is missing: $support_runtime_preparer" >&2
  exit 1
fi

if [ "$rabbitmq_config_file" = '/etc/rabbitmq/rabbitmq.conf' ] && [ ! -e "$rabbitmq_config_file" ]; then
  install -o root -g rabbitmq -m 0640 /dev/null "$rabbitmq_config_file"
fi

replace_or_append_setting() {
  file="$1"
  setting="$2"
  replacement="$3"
  owner="${4:-}"
  group="${5:-}"
  mode="${6:-0640}"

  [ -f "$file" ] || {
    echo "OnlyOffice support-service configuration is missing: $file" >&2
    exit 1
  }

  tmp="$(mktemp "$(dirname "$file")/.onlyoffice-v5.XXXXXX")"
  awk -v setting="$setting" -v replacement="$replacement" '
    BEGIN { replaced=0 }
    {
      candidate=$0
      sub(/^[[:space:]]*#[[:space:]]*/, "", candidate)
      sub(/^[[:space:]]*/, "", candidate)
      if (index(candidate, setting) == 1) {
        rest=substr(candidate, length(setting) + 1)
        if (rest ~ /^[[:space:]]*=/ || rest ~ /^[[:space:]]+/) {
          if (!replaced) {
            print replacement
            replaced=1
          }
          next
        }
      }
      print
    }
    END {
      if (!replaced) print replacement
    }
  ' "$file" > "$tmp"
  chmod "$mode" "$tmp"
  if [ "$(id -u)" -eq 0 ] && [ -n "$owner" ] && [ -n "$group" ]; then
    chown "$owner:$group" "$tmp"
  fi
  mv -f "$tmp" "$file"
}

# The pinned DocumentServer package currently contains one local PostgreSQL
# cluster. Reject an unexpected packaging change instead of guessing which
# cluster should be trusted.
shopt -s nullglob
postgresql_configs=( $postgresql_config_glob )
shopt -u nullglob
if [ "${#postgresql_configs[@]}" -ne 1 ]; then
  echo "Expected exactly one bundled PostgreSQL configuration, found ${#postgresql_configs[@]} for ${postgresql_config_glob}" >&2
  exit 1
fi
"$node_bin" "$support_runtime_preparer" "${postgresql_configs[0]}" "$postgresql_socket_dir"
replace_or_append_setting \
  "${postgresql_configs[0]}" \
  listen_addresses \
  "listen_addresses = '127.0.0.1'" \
  postgres postgres 0644
replace_or_append_setting \
  "${postgresql_configs[0]}" \
  port \
  'port = 5432' \
  postgres postgres 0644
# The bundled cluster defaults its socket directory to /var/run/postgresql,
# which resolves onto the container's fuse-overlayfs root. PostgreSQL chmods
# its Unix-domain socket after binding it, that chmod returns EPERM there, and
# the failure is fatal, so the Document Server waits forever for port 5432:
#
#   could not set permissions of file "/var/run/postgresql/.s.PGSQL.5432"
#   FATAL: could not create any Unix-domain sockets
#
# /dev/shm is a real tmpfs in this runtime and does permit the chmod, so keep
# the socket there instead of disabling local connections entirely.
#
# The directory is created only by the guarded preparer below, never by an
# install -d here: /dev/shm is world-writable, so an unprivileged process could
# pre-create the path as a symlink and redirect a root-run chown onto its
# target. The preparer opens with O_NOFOLLOW and re-verifies after preparation.
replace_or_append_setting \
  "${postgresql_configs[0]}" \
  unix_socket_directories \
  "unix_socket_directories = '${postgresql_socket_dir}'" \
  postgres postgres 0644
# Re-assert the contract after the atomic postgresql.conf replacements so
# service startup cannot consume ownership or mode drift introduced in between.
"$node_bin" "$support_runtime_preparer" "${postgresql_configs[0]}" "$postgresql_socket_dir"

# Community DocumentServer currently disables Redis, but keep its bundled
# configuration closed in case a pinned edition enables it later.
replace_or_append_setting "$redis_config_file" bind 'bind 127.0.0.1' redis redis 0640
replace_or_append_setting "$redis_config_file" protected-mode 'protected-mode yes' redis redis 0640
replace_or_append_setting "$redis_config_file" port 'port 6379' redis redis 0640

replace_or_append_setting "$rabbitmq_config_file" listeners.tcp.default \
  'listeners.tcp.default = 127.0.0.1:5672' root rabbitmq 0640
replace_or_append_setting "$rabbitmq_config_file" distribution.listener.interface \
  'distribution.listener.interface = 127.0.0.1' root rabbitmq 0640
replace_or_append_setting "$rabbitmq_config_file" vm_memory_calculation_strategy \
  'vm_memory_calculation_strategy = erlang' root rabbitmq 0640

replace_or_append_setting "$rabbitmq_env_file" NODE_IP_ADDRESS \
  'NODE_IP_ADDRESS=127.0.0.1' root rabbitmq 0640
replace_or_append_setting "$rabbitmq_env_file" NODENAME \
  'NODENAME=rabbit@localhost' root rabbitmq 0640
replace_or_append_setting "$rabbitmq_env_file" NODE_PORT \
  'NODE_PORT=5672' root rabbitmq 0640
replace_or_append_setting "$rabbitmq_env_file" ERL_EPMD_ADDRESS \
  'ERL_EPMD_ADDRESS=127.0.0.1' root rabbitmq 0640

grep -qx "listen_addresses = '127.0.0.1'" "${postgresql_configs[0]}"
grep -qx "unix_socket_directories = '${postgresql_socket_dir}'" "${postgresql_configs[0]}"
grep -qx 'bind 127.0.0.1' "$redis_config_file"
grep -qx 'protected-mode yes' "$redis_config_file"
grep -qx 'listeners.tcp.default = 127.0.0.1:5672' "$rabbitmq_config_file"
grep -qx 'distribution.listener.interface = 127.0.0.1' "$rabbitmq_config_file"
grep -qx 'NODE_IP_ADDRESS=127.0.0.1' "$rabbitmq_env_file"
grep -qx 'NODENAME=rabbit@localhost' "$rabbitmq_env_file"
grep -qx 'ERL_EPMD_ADDRESS=127.0.0.1' "$rabbitmq_env_file"
