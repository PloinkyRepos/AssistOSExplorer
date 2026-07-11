#!/bin/bash
set -euo pipefail

source_script="${ONLYOFFICE_DOCUMENT_SERVER_BASE_SCRIPT:-/app/ds/run-document-server.sh}"
patched_script="${TMPDIR:-/tmp}/onlyoffice-agent-run-document-server.$$.sh"
rabbitmq_config_file="${ONLYOFFICE_RABBITMQ_CONFIG_FILE:-/etc/rabbitmq/rabbitmq.conf}"

if [ ! -f "$source_script" ]; then
  echo "OnlyOffice Document Server script not found: $source_script" >&2
  exit 1
fi

# Nested rootless Podman cannot expose the inner PID namespace through the
# outer container's procfs. RabbitMQ's default rss strategy consequently tries
# to read a PID that is not present in /proc and aborts before Document Server
# starts. The supported erlang strategy obtains process memory from the VM and
# does not depend on that procfs lookup.
rabbitmq_config_dir="$(dirname "$rabbitmq_config_file")"
install -d -m 0755 "$rabbitmq_config_dir"
rabbitmq_config_tmp="$(mktemp "$rabbitmq_config_dir/.rabbitmq.conf.XXXXXX")"
if [ -f "$rabbitmq_config_file" ]; then
  awk '!/^[[:space:]]*vm_memory_calculation_strategy[[:space:]]*=/' \
    "$rabbitmq_config_file" > "$rabbitmq_config_tmp"
  chmod --reference="$rabbitmq_config_file" "$rabbitmq_config_tmp"
  if [ "$(id -u)" -eq 0 ]; then
    chown --reference="$rabbitmq_config_file" "$rabbitmq_config_tmp"
  fi
else
  chmod 0640 "$rabbitmq_config_tmp"
  chown root:rabbitmq "$rabbitmq_config_tmp"
fi
printf '%s\n' 'vm_memory_calculation_strategy = erlang' >> "$rabbitmq_config_tmp"
mv -f "$rabbitmq_config_tmp" "$rabbitmq_config_file"

awk '
  /^[[:space:]]*service \$i start[[:space:]]*$/ {
    print "  if [ \"$i\" = \"rabbitmq-server\" ]; then"
    print "    install -d -o rabbitmq -g rabbitmq -m 0755 /var/run/rabbitmq"
    print "    RABBITMQ_PID_FILE=/var/run/rabbitmq/pid start-stop-daemon --quiet --chuid rabbitmq --start --exec /usr/sbin/rabbitmq-server --pidfile /var/run/rabbitmq/pid --background"
    print "  else"
    print "    service \"$i\" start"
    print "  fi"
    rabbitmq_start_patched++
    next
  }
  /service supervisor start/ && inserted == 0 {
    print "onlyoffice_agent_autoassembly_enabled=\"${ONLYOFFICE_AUTO_ASSEMBLY_ENABLED:-true}\""
    print "case \"$onlyoffice_agent_autoassembly_enabled\" in"
    print "  true|TRUE|1|yes|YES|on|ON) onlyoffice_agent_autoassembly_json=true ;;"
    print "  *) onlyoffice_agent_autoassembly_json=false ;;"
    print "esac"
    print "onlyoffice_agent_autoassembly_interval=\"${ONLYOFFICE_AUTO_ASSEMBLY_INTERVAL:-1m}\""
    print "onlyoffice_agent_autoassembly_step=\"${ONLYOFFICE_AUTO_ASSEMBLY_STEP:-1m}\""
    print "[[ \"$onlyoffice_agent_autoassembly_interval\" =~ ^[0-9]+[smhd]$ ]] || onlyoffice_agent_autoassembly_interval=1m"
    print "[[ \"$onlyoffice_agent_autoassembly_step\" =~ ^[0-9]+[smhd]$ ]] || onlyoffice_agent_autoassembly_step=1m"
    print "${JSON} -I -e \"this.services.CoAuthoring.autoAssembly = this.services.CoAuthoring.autoAssembly || {}\""
    print "${JSON} -I -e \"this.services.CoAuthoring.autoAssembly.enable = ${onlyoffice_agent_autoassembly_json}\""
    print "${JSON} -I -e \"this.services.CoAuthoring.autoAssembly.interval = \047${onlyoffice_agent_autoassembly_interval}\047\""
    print "${JSON} -I -e \"this.services.CoAuthoring.autoAssembly.step = \047${onlyoffice_agent_autoassembly_step}\047\""
    inserted = 1
  }
  { print }
  END {
    if (rabbitmq_start_patched != 1) {
      exit 42
    }
  }
' "$source_script" > "$patched_script"

chmod +x "$patched_script"
exec /bin/bash "$patched_script"
