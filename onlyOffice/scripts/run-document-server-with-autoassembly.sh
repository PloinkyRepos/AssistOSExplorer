#!/bin/bash
set -euo pipefail

source_script="${ONLYOFFICE_DOCUMENT_SERVER_BASE_SCRIPT:-/app/ds/run-document-server.sh}"
patched_script="${TMPDIR:-/tmp}/onlyoffice-agent-run-document-server.$$.sh"

if [ ! -f "$source_script" ]; then
  echo "OnlyOffice Document Server script not found: $source_script" >&2
  exit 1
fi

awk '
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
' "$source_script" > "$patched_script"

chmod +x "$patched_script"
exec /bin/bash "$patched_script"
