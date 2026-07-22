#!/bin/bash
set -euo pipefail

source_script="${ONLYOFFICE_DOCUMENT_SERVER_BASE_SCRIPT:-/app/ds/run-document-server.sh}"
patched_script="${TMPDIR:-/tmp}/onlyoffice-agent-run-document-server.$$.sh"
configure_v5_script="${ONLYOFFICE_V5_CONFIGURE_SCRIPT:-/code/scripts/configure-document-server-v5.sh}"
configure_support_listeners_script="${ONLYOFFICE_SUPPORT_LISTENER_SCRIPT:-/code/scripts/configure-support-listeners-v5.sh}"

if [ ! -f "$source_script" ]; then
  echo "OnlyOffice Document Server script not found: $source_script" >&2
  exit 1
fi

if [ ! -x "$configure_support_listeners_script" ]; then
  echo "OnlyOffice support-listener configuration script is missing or not executable: $configure_support_listeners_script" >&2
  exit 1
fi

awk \
  -v configure_v5_script="$configure_v5_script" \
  -v configure_support_listeners_script="$configure_support_listeners_script" '
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
    print "/bin/bash \"" configure_v5_script "\" || { echo \"OnlyOffice v5 DocumentServer configuration failed; refusing startup.\" >&2; exit 1; }"
    inserted = 1
  }
  /#start needed local services/ && support_listeners_inserted == 0 {
    print "/bin/bash \"" configure_support_listeners_script "\" || { echo \"OnlyOffice v5 support-listener configuration failed; refusing startup.\" >&2; exit 1; }"
    support_listeners_inserted = 1
  }
  { print }
  END {
    if (rabbitmq_start_patched != 1) {
      exit 42
    }
    if (support_listeners_inserted != 1) {
      exit 43
    }
  }
' "$source_script" > "$patched_script"

chmod +x "$patched_script"
exec /bin/bash "$patched_script"
