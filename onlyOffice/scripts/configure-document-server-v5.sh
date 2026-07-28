#!/usr/bin/env bash
set -euo pipefail

config_file="${ONLYOFFICE_LOCAL_CONFIG_FILE:-/etc/onlyoffice/documentserver/local.json}"
docservice_supervisor_file="/etc/supervisor/conf.d/ds-docservice.conf"
docservice_bind_interposer="/usr/local/lib/onlyoffice-docservice-loopback-bind.so"
docservice_nginx_configurator="/code/scripts/configure-docservice-nginx-loopback.mjs"
image_contract_file="/usr/local/share/ploinky/onlyoffice.contract"
: "${JWT_SECRET:?JWT_SECRET is required}"

if [ ! -f "${config_file}" ]; then
  echo "OnlyOffice local configuration is missing: ${config_file}" >&2
  exit 1
fi

json_bin="/var/www/onlyoffice/documentserver/npm/json"
if [ ! -x "${json_bin}" ] || [ -L "${json_bin}" ]; then
  echo 'OnlyOffice image is missing the json configuration utility.' >&2
  exit 1
fi

if [ ! -f "$docservice_bind_interposer" ] || [ -L "$docservice_bind_interposer" ]; then
  echo 'OnlyOffice v5 image contract is unavailable: the pinned DocService loopback bind interposer is missing. Publish and pin the verified v5 image before activation.' >&2
  exit 1
fi
if [ ! -f "$image_contract_file" ] || [ -L "$image_contract_file" ]; then
  echo 'OnlyOffice v5 image contract marker is missing. Publish and pin the verified v5 image before activation.' >&2
  exit 1
fi
if [ "$(stat -c '%u:%g:%a' "$image_contract_file")" != '0:0:444' ]; then
  echo 'OnlyOffice v5 image contract marker ownership or mode is invalid.' >&2
  exit 1
fi
if [ "$(sed -n '1p' "$image_contract_file")" != 'contract_version=5' ] \
  || [ "$(sed -n '2p' "$image_contract_file")" != 'documentserver_index_sha256=53a06109f1f4029a78f913a061e14f01bff023d109024073a13d4416b54d2195' ] \
  || [ "$(sed -n '3p' "$image_contract_file")" != 'ubuntu_snapshot=20260712T000000Z' ] \
  || [ "$(sed -n '4p' "$image_contract_file")" != 'docservice_bind_scope=docservice-port-8000' ] \
  || [ "$(wc -l < "$image_contract_file")" -ne 5 ]; then
  echo 'OnlyOffice v5 image contract marker does not match the approved runtime contract.' >&2
  exit 1
fi
expected_interposer_sha256="$(sed -n 's/^interposer_sha256=//p' "$image_contract_file")"
if ! [[ "$expected_interposer_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'OnlyOffice v5 image contract marker contains an invalid interposer digest.' >&2
  exit 1
fi
if ! printf '%s  %s\n' "$expected_interposer_sha256" "$docservice_bind_interposer" | sha256sum --check --strict - >/dev/null; then
  echo 'OnlyOffice v5 DocService loopback bind interposer digest does not match its image contract.' >&2
  exit 1
fi
if [ ! -f "$docservice_supervisor_file" ]; then
  echo "OnlyOffice image is missing the pinned DocService supervisor definition: $docservice_supervisor_file" >&2
  exit 1
fi
if [ "$(grep -c '^environment=' "$docservice_supervisor_file")" -ne 1 ]; then
  echo 'OnlyOffice DocService supervisor environment shape changed; refusing an unscoped runtime patch.' >&2
  exit 1
fi
if grep -q 'LD_PRELOAD\|ONLYOFFICE_DOCSERVICE_BIND_SCOPE' "$docservice_supervisor_file"; then
  echo 'OnlyOffice DocService supervisor definition already contains an unexpected bind override.' >&2
  exit 1
fi
sed -i \
  '/^environment=/s#$#,LD_PRELOAD=/usr/local/lib/onlyoffice-docservice-loopback-bind.so,ONLYOFFICE_DOCSERVICE_BIND_SCOPE=docservice-port-8000#' \
  "$docservice_supervisor_file"
grep -q '^environment=.*LD_PRELOAD=/usr/local/lib/onlyoffice-docservice-loopback-bind\.so,ONLYOFFICE_DOCSERVICE_BIND_SCOPE=docservice-port-8000$' \
  "$docservice_supervisor_file"

/usr/local/bin/node "$docservice_nginx_configurator"

"${json_bin}" -I -f "${config_file}" -e 'this.services=this.services||{};this.services.CoAuthoring=this.services.CoAuthoring||{};this.services.CoAuthoring.token=this.services.CoAuthoring.token||{};this.services.CoAuthoring.token.enable=this.services.CoAuthoring.token.enable||{};this.services.CoAuthoring.token.enable.request=this.services.CoAuthoring.token.enable.request||{};this.services.CoAuthoring.token.enable.request.outbox=true'
"${json_bin}" -I -f "${config_file}" -e 'this.services.CoAuthoring.token.outbox=this.services.CoAuthoring.token.outbox||{};this.services.CoAuthoring.token.outbox.algorithm="HS256";this.services.CoAuthoring.token.outbox.expires="5m";this.services.CoAuthoring.token.outbox.inBody=true;this.services.CoAuthoring.token.outbox.urlExclusionRegex=""'

# DocumentServer is an implementation detail behind the decorator. Bind every
# port-80 nginx server to process loopback before supervisor starts it.
while IFS= read -r -d '' nginx_config; do
  sed -E -i \
    's/^([[:space:]]*)listen[[:space:]]+(0\.0\.0\.0:)?(80|443)([[:space:]][^;]*)?;/\1listen 127.0.0.1:\3\4;/' \
    "${nginx_config}"
  sed -E -i \
    's/^([[:space:]]*)listen[[:space:]]+\[::\]:(80|443)([[:space:]][^;]*)?;/\1listen [::1]:\2\3;/' \
    "${nginx_config}"
done < <(find -L /etc/nginx /etc/onlyoffice/documentserver/nginx \
  -type f \( -name '*.conf' -o -name '*.tmpl' \) -print0)

# The pinned startup script defines its generated cache variables only after
# this hook runs, so `nginx -t` would fail here for an unrelated temporary
# reason. Inspect every included configuration byte directly; the upstream
# script performs the real service start after generating those variables.
if find -L /etc/nginx /etc/onlyoffice/documentserver/nginx \
  -type f \( -name '*.conf' -o -name '*.tmpl' \) -exec \
  grep -E '^[[:space:]]*listen[[:space:]]+(0\.0\.0\.0:|\[::\]:)?(80|443)([[:space:];]|$)' {} + \
  >/dev/null 2>&1; then
  echo 'OnlyOffice nginx still contains a wildcard port-80 listener after v5 configuration.' >&2
  exit 1
fi
