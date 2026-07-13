import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const explorerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.dirname(explorerRoot);

async function readWorkflow(fileName = 'deploy-explorer-qa.yml') {
    return fs.readFile(path.join(repoRoot, '.github/workflows', fileName), 'utf8');
}

test('Explorer pins container-image-builds to main independently of the global branch', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(explorerRoot, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.repos['container-image-builds'], {
        url: 'https://github.com/AssistOS-AI/container-image-builds.git',
        branch: 'main',
    });
});

test('Explorer-local agent manifests leave host port 18083 reserved for the Web Publishing external connector', async () => {
    const directoryEntries = await fs.readdir(repoRoot, { withFileTypes: true });
    const publishedPorts = [];
    for (const entry of directoryEntries) {
        if (!entry.isDirectory()) continue;
        const manifestFile = path.join(repoRoot, entry.name, 'manifest.json');
        let manifest;
        try {
            manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        } catch (error) {
            if (error?.code === 'ENOENT') continue;
            throw error;
        }
        for (const [profile, definition] of Object.entries(manifest.profiles || {})) {
            for (const port of definition.openPorts || []) {
                publishedPorts.push({ agent: entry.name, profile, port: String(port) });
            }
        }
    }

    assert.equal(
        publishedPorts.some(({ port }) => /(?:^|:)18083:/.test(port)),
        false,
        JSON.stringify(publishedPorts.filter(({ port }) => port.includes('18083'))),
    );
    assert.equal(
        publishedPorts.some(({ agent, profile, port }) => (
            agent === 'onlyOffice'
            && profile === 'dev'
            && port === '127.0.0.1:18082:8080'
        )),
        true,
        'OnlyOffice dev owns 18082; Web Publishing must remain on the distinct reserved port 18083.',
    );
});

for (const [label, fileName, variablePrefix] of [
    ['QA', 'deploy-explorer-qa.yml', 'EXPLORER_QA_'],
    ['production', 'deploy-skills-explorer.yml', ''],
]) {
test(`Explorer ${label} workflow installs and starts the basic repo for Web Publishing`, async () => {
    const workflow = await readWorkflow(fileName);

    assert.match(workflow, /basic_branch:/);
    assert.match(workflow, /BASIC_BRANCH:/);
    assert.match(workflow, /install https:\/\/github\.com\/AssistOS-AI\/basic\.git basic --branch "\$\{BASIC_BRANCH:-ploinky-box\}"/);
    assert.match(workflow, /"basic:\$\{BASIC_BRANCH:-ploinky-box\}"/);
    assert.match(workflow, /--repo-branch "basic=\$\{BASIC_BRANCH:-ploinky-box\}"/);
    assert.match(workflow, /webmeet_infra_branch:/);
    assert.match(workflow, /WEBMEET_INFRA_BRANCH:/);
    assert.match(workflow, /install https:\/\/github\.com\/AssistOS-AI\/webmeetInfra\.git webmeetInfra --branch "\$\{WEBMEET_INFRA_BRANCH:-ploinky-box\}"/);
    assert.match(workflow, /"webmeetInfra:\$\{WEBMEET_INFRA_BRANCH:-ploinky-box\}"/);
    assert.match(workflow, /--repo-branch "webmeetInfra=\$\{WEBMEET_INFRA_BRANCH:-ploinky-box\}"/);
    assert.match(workflow, /--repo-branch "container-image-builds=main"/);
    assert.doesNotMatch(workflow, /webmeetInfra(?::|=)main|webmeetInfra.*--branch main/);
    assert.doesNotMatch(workflow, /basic\/cloudflared/);
});

test(`Explorer ${label} workflow defaults the Ploinky runtime to ploinky-box`, async () => {
    const workflow = await readWorkflow(fileName);
    const varsPrefix = label === 'QA' ? 'EXPLORER_QA_' : '';

    assert.match(
        workflow,
        new RegExp(`PLOINKY_BRANCH: \\\${\\\{ inputs\\.ploinky_branch \\\|\\\| vars\\.${varsPrefix}PLOINKY_BRANCH \\\|\\\| 'ploinky-box' \\\}\\\}`),
    );
    assert.match(workflow, /PLOINKY_BRANCH="\$\{PLOINKY_BRANCH:-ploinky-box\}"/);
    assert.doesNotMatch(workflow, /PLOINKY_BRANCH[^\n]*(?:then |:-|'|")master/);
    assert.match(workflow, /else\n\s+echo "\[deploy(?:-qa)?\] ERROR: cannot checkout Ploinky branch/);
});

test(`Explorer ${label} workflow accepts only Web Publishing inputs for public topology`, async () => {
    const workflow = await readWorkflow(fileName);
    const legacyTokenName = ['CLOUDFLARED', 'TUNNEL', 'TOKEN'].join('_');
    const standaloneLegacyToken = new RegExp(`(^|[^A-Z0-9_])${legacyTokenName}([^A-Z0-9_]|$)`);

    assert.match(workflow, new RegExp(`${variablePrefix}WEB_PUBLISHING_BASE_DOMAIN`));
    assert.match(workflow, new RegExp(`${variablePrefix}WEB_PUBLISHING_TLS_EDGE`));
    assert.match(workflow, new RegExp(`${variablePrefix}WEB_PUBLISHING_LIVEKIT_MEDIA_IP`));
    assert.match(workflow, new RegExp(`${variablePrefix}WEB_PUBLISHING_TURN_EXTERNAL_IP`));
    assert.match(workflow, new RegExp(`${variablePrefix}WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN`));
    assert.match(workflow, /WEB_PUBLISHING_CLOUDFLARE_API_TOKEN/);
    assert.match(workflow, /echo "\\\$\$1"/);

    assert.doesNotMatch(workflow, new RegExp(`vars\\.${variablePrefix}ONLYOFFICE_PUBLIC_URL`));
    assert.doesNotMatch(workflow, new RegExp(`vars\\.${variablePrefix}WEBMEET_PUBLIC_LIVEKIT_URL`));
    assert.doesNotMatch(workflow, new RegExp(`vars\\.${variablePrefix}WEB_PUBLISHING_PUBLIC_HOST`));
    assert.doesNotMatch(workflow, new RegExp(`vars\\.${variablePrefix}WEB_PUBLISHING_CERT_EMAIL`));
    assert.doesNotMatch(workflow, /\bwrite_env WEB_PUBLISHING_(?:PUBLIC_HOST|CERT_EMAIL)/);
    assert.doesNotMatch(workflow, /\bset_var WEB_PUBLISHING_(?:PUBLIC_HOST|CERT_EMAIL)/);
    assert.doesNotMatch(workflow, /\bwrite_env ONLYOFFICE_/);
    assert.doesNotMatch(workflow, /\bset_var ONLYOFFICE_/);
    assert.doesNotMatch(workflow, /\bwrite_env WEBMEET_PUBLIC_LIVEKIT_URL/);
    assert.doesNotMatch(workflow, /\bset_var WEBMEET_PUBLIC_LIVEKIT_URL/);
    assert.doesNotMatch(workflow, /\bwrite_env WEBMEET_TLS_HOSTNAME/);
    assert.doesNotMatch(workflow, /\bset_var WEBMEET_TLS_HOSTNAME/);
    assert.doesNotMatch(workflow, /\bwrite_env WEBMEET_LIVEKIT_UPSTREAM/);
    assert.doesNotMatch(workflow, /\bset_var WEBMEET_LIVEKIT_UPSTREAM/);
    assert.doesNotMatch(workflow, /\bwrite_env WEBMEET_CERT_EMAIL/);
    assert.doesNotMatch(workflow, /\bset_var WEBMEET_CERT_EMAIL/);
    assert.doesNotMatch(workflow, /\bwrite_env WEBMEET_TURN_HOST/);
    assert.doesNotMatch(workflow, /\bset_var WEBMEET_TURN_HOST/);
    assert.doesNotMatch(workflow, /\bwrite_env WEBMEET_TURN_REALM/);
    assert.doesNotMatch(workflow, /\bset_var WEBMEET_TURN_REALM/);
    assert.doesNotMatch(workflow, /\bwrite_env WEBMEET_(?:EGRESS_URL|INFRA_HEALTH_PORT|INFRA_IMAGE_TAG|LIVEKIT_NODE_IP|LIVEKIT_USE_EXTERNAL_IP|TLS_|CERTBOT_|TURN_(?:PORT|USER|PASSWORD|MIN_PORT|MAX_PORT))/);
    assert.doesNotMatch(workflow, /\bset_var WEBMEET_(?:EGRESS_URL|INFRA_HEALTH_PORT|INFRA_IMAGE_TAG|LIVEKIT_NODE_IP|LIVEKIT_USE_EXTERNAL_IP|TLS_|CERTBOT_|TURN_(?:PORT|USER|PASSWORD|MIN_PORT|MAX_PORT))/);
    assert.doesNotMatch(workflow, /127\.0\.0\.1:\$\{WEBMEET_INFRA_HEALTH_PORT\}/);
    assert.doesNotMatch(workflow, /webmeet_infra_image_tag:/);
    assert.match(workflow, /podman pull "docker\.io\/assistos\/livekit-server-agent:webmeet-infra"/);
    assert.match(workflow, /Router readiness confirms blocking WebMeet infrastructure dependencies completed/);
    assert.match(workflow, /'WEBMEET_TURN_ALLOWED_PEER_IPS'/);
    assert.doesNotMatch(workflow, standaloneLegacyToken);

    const livekitProbeIndex = workflow.lastIndexOf('Verifying the exact public LiveKit /rtc signaling route');
    const summaryIndex = workflow.indexOf('- name: Create summary');
    assert.notEqual(livekitProbeIndex, -1);
    assert.notEqual(summaryIndex, -1);
    assert.ok(livekitProbeIndex < summaryIndex);
    assert.match(workflow, /WEBMEET_PUBLIC_LIVEKIT_URL="\$\(read_workspace_var WEBMEET_PUBLIC_LIVEKIT_URL\)"\n\n\s+expected_livekit_url="wss:\/\/meet\.\$\{WEB_PUBLISHING_BASE_DOMAIN\}"/);
    assert.match(workflow, /WEBMEET_PUBLIC_LIVEKIT_URL="\$\(public_var WEBMEET_PUBLIC_LIVEKIT_URL\)"\n\n\s+expected_livekit_url="wss:\/\/meet\.\$\{WEB_PUBLISHING_BASE_DOMAIN\}"/);
    assert.match(workflow, /if \[ "\$\{WEBMEET_PUBLIC_LIVEKIT_URL:-\}" != "\$expected_livekit_url" \]; then/);
    assert.match(workflow, /Web Publishing must publish canonical WEBMEET_PUBLIC_LIVEKIT_URL=\$expected_livekit_url/);
    assert.match(workflow, /livekit_probe_url="https:\/\/meet\.\$\{WEB_PUBLISHING_BASE_DOMAIN\}"/);
    assert.doesNotMatch(workflow, /livekit_probe_url="\$\{WEBMEET_PUBLIC_LIVEKIT_URL\/#wss:/);
    assert.doesNotMatch(workflow, /#ws:\/http:/);
    assert.match(workflow, /curl -s --http1\.1 --connect-timeout 5 --max-time 15 -o \/dev\/null -w '%\{http_code\}'/);
    assert.match(workflow, /-H 'Connection: Upgrade'/);
    assert.match(workflow, /-H 'Upgrade: websocket'/);
    assert.match(workflow, /"\$\{livekit_probe_url%\/\}\/rtc"/);
    assert.match(workflow, /if \[ "\$code" = "401" \]/);
    assert.doesNotMatch(workflow, /livekit_probe_url%\/\}\/"/);
    assert.doesNotMatch(workflow, /livekit-public-response\.txt/);

    if (label === 'QA') {
        assert.doesNotMatch(workflow, /- name: Verify public (?:URL|endpoints)\n\s+if:/);
    }
});

test(`Explorer ${label} managed workflow rejects Cloudflare API mutation mode`, async () => {
    const workflow = await readWorkflow(fileName);

    assert.match(workflow, /cloudflare-api\)\n\s+echo "::error::[^\n]+is not supported by this managed deploy workflow because it does not apply external Cloudflare tunnel or DNS mutations/);
    assert.match(workflow, /Pre-provision the tunnel and DNS-only turn\.\$\{WEB_PUBLISHING_BASE_DOMAIN:-<base-domain>\} A record/);
    assert.match(workflow, /nginx\|cloudflare-token\|token\|nginx-cloudflare\) ;;/);
    assert.doesNotMatch(workflow, /nginx\|cloudflare-token\|token\|nginx-cloudflare\|cloudflare-api\) ;;/);
    assert.doesNotMatch(workflow, /\b(?:applyTunnel|applyDns|applyPlan)\b/);
});

test(`Explorer ${label} workflow rejects incompatible Web Publishing mode and TLS-edge pairs before remote mutation`, async () => {
    const workflow = await readWorkflow(fileName);
    const pairGuardIndex = workflow.indexOf('nginx:external|cloudflare-token:cloudflare|token:cloudflare|nginx-cloudflare:cloudflare');
    const shutdownIndex = workflow.indexOf('"$PLOINKY" shutdown');
    const checkoutIndex = workflow.indexOf('checkout_runtime_branch()');

    assert.notEqual(pairGuardIndex, -1);
    assert.notEqual(shutdownIndex, -1);
    assert.notEqual(checkoutIndex, -1);
    assert.ok(pairGuardIndex < shutdownIndex);
    assert.ok(pairGuardIndex < checkoutIndex);
    assert.match(workflow, /WEB_PUBLISHING_MODE=nginx requires (?:EXPLORER_QA_)?WEB_PUBLISHING_TLS_EDGE=external/);
    assert.match(workflow, /Token-mode Web Publishing requires (?:EXPLORER_QA_)?WEB_PUBLISHING_TLS_EDGE=cloudflare/);
});

test(`Explorer ${label} workflow validates canonical domain and public IPv4 inputs before remote mutation`, async () => {
    const workflow = await readWorkflow(fileName);
    const canonicalGuardIndex = workflow.indexOf("const validLabel = /^[a-z0-9]");
    const prepareSshIndex = workflow.indexOf('- name: Prepare SSH key');
    const shutdownIndex = workflow.indexOf('"$PLOINKY" shutdown');

    assert.notEqual(canonicalGuardIndex, -1);
    assert.notEqual(prepareSshIndex, -1);
    assert.notEqual(shutdownIndex, -1);
    assert.ok(canonicalGuardIndex < prepareSshIndex);
    assert.ok(canonicalGuardIndex < shutdownIndex);
    assert.match(workflow, /domain === domain\.trim\(\)/);
    assert.match(workflow, /domain === domain\.toLowerCase\(\)/);
    assert.match(workflow, /isIP\(value\) !== 4/);
    assert.match(workflow, /first === 0[\s\S]*first === 127[\s\S]*first >= 224[\s\S]*first === 169 && second === 254/);
});

test(`Explorer ${label} workflow validates operator-provisioned TURN TLS before repository or start work`, async () => {
    const workflow = await readWorkflow(fileName);
    const preflightIndex = workflow.indexOf('preflight_turn_endpoint\n');
    const checkoutIndex = workflow.indexOf('checkout_runtime_branch()');
    const installIndex = workflow.indexOf('install https://github.com/AssistOS-AI/AssistOSExplorer.git');
    const startIndex = workflow.indexOf('start AchillesIDE/explorer');

    assert.notEqual(preflightIndex, -1);
    assert.notEqual(checkoutIndex, -1);
    assert.notEqual(installIndex, -1);
    assert.notEqual(startIndex, -1);
    assert.ok(preflightIndex < checkoutIndex);
    assert.ok(preflightIndex < installIndex);
    assert.ok(preflightIndex < startIndex);

    assert.match(workflow, /\.ploinky\/data\/webmeetTls\/turn/);
    assert.match(workflow, /cert_path="\$tls_dir\/fullchain\.pem"/);
    assert.match(workflow, /key_path="\$tls_dir\/privkey\.pem"/);
    assert.match(workflow, /if \[ -L "\$file_path" \]/);
    assert.match(workflow, /if \[ ! -e "\$file_path" \]/);
    assert.match(workflow, /if \[ ! -f "\$file_path" \]/);
    assert.match(workflow, /if \[ ! -r "\$file_path" \]/);
    assert.match(workflow, /openssl x509 -in "\$cert_path" -noout -checkend 0/);
    assert.match(workflow, /openssl x509 -in "\$cert_path" -noout -checkhost "\$turn_host"/);
    assert.match(workflow, /openssl pkey -in "\$key_path" -noout -check/);
    assert.match(workflow, /if \[ -z "\$cert_public_key" \] \|\| \[ "\$cert_public_key" != "\$private_public_key" \]/);
});

test(`Explorer ${label} public modes require an exact TURN A record and no AAAA record before deployment`, async () => {
    const workflow = await readWorkflow(fileName);

    assert.match(workflow, /dns\.resolve4\(host\)/);
    assert.match(workflow, /dns\.resolve6\(host\)/);
    assert.match(workflow, /\['ENODATA', 'ENOTFOUND'\]\.includes\(error\?\.code\)/);
    assert.match(workflow, /if \(ipv6Addresses\.length > 0\)/);
    assert.match(workflow, /public TURN is IPv4-only; remove every AAAA record for \$turn_host before deployment/);
    assert.match(workflow, /could not confirm that \$turn_host has no AAAA record because its IPv6 DNS lookup failed unexpectedly/);
    assert.match(workflow, /if \[ "\$dns_addresses" != "\$WEB_PUBLISHING_TURN_EXTERNAL_IP" \]/);
    assert.match(workflow, /public Web Publishing requires every A record for \$turn_host to equal \$WEB_PUBLISHING_TURN_EXTERNAL_IP/);
    assert.match(workflow, /DNS resolution cannot prove Cloudflare proxy status; the \$turn_host record must be configured DNS-only/);
    assert.doesNotMatch(workflow, /case "\$mode" in/);
});
}
