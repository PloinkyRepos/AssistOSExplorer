import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORKFLOWS = [
  {
    file: '.github/workflows/deploy-explorer-qa.yml',
    name: 'Deploy Explorer QA Box',
    expected: [
      "DEPLOY_BRANCH: 'ploinky-proxy'",
      "PLOINKY_BRANCH: 'ploinky-proxy'",
      "SSH_USER: 'admin'",
      "SSH_HOST: '45.136.70.141'",
      "SSH_ED25519_FINGERPRINT: 'SHA256:pcVG+7QFbfi3Ojn3LeveNutqCWaTOIlgek1o3GKD/KA'",
      "WORKSPACE: 'explorerQaWorkspace'",
      "PUBLIC_HOST: 'explorer-qa.axiologic.dev'",
      "PLOINKY_NO_WAIT_SEQUENCE_TERMINAL_GRACE_MS='300000'",
      '"$PLOINKY" start explorer --branch=ploinky-proxy',
      "'AchillesIDE|https://github.com/AssistOS-AI/AssistOSExplorer.git'",
      "'webmeetInfra|https://github.com/AssistOS-AI/webmeetInfra.git'",
      "'UmamiAgent|https://github.com/AssistOS-AI/UmamiAgent.git'",
      "'AchillesCLI|https://github.com/AssistOS-AI/AchillesCLI.git'",
      "'copilot-agents|https://github.com/AssistOS-AI/copilot-agents.git'",
      "'proxies|https://github.com/AssistOS-AI/proxies.git'",
      "'basic|https://github.com/AssistOS-AI/basic.git'",
      "'container-image-builds|https://github.com/AssistOS-AI/container-image-builds.git'",
      "CLOUDFLARE_TUNNEL_NAME: 'explorer-qa'",
      "CLOUDFLARE_PROTECTED_SHARED_TUNNEL_ID: '091c4096-d1c8-4dbc-bb12-0c6357431d96'",
      "CLOUDFLARE_TUNNEL_SECRET_HANDLE: 'publication/explorer-qa-tunnel'",
      "CLOUDFLARE_API_SECRET_HANDLE: 'publication/explorer-qa-api'",
      'EXPLORER_QA_CLOUDFLARE_API_TOKEN',
      'EXPLORER_QA_CLOUDFLARE_ACCOUNT_ID',
      'EXPLORER_QA_CLOUDFLARE_ZONE_ID',
      'EXPLORER_QA_PLOINKY_MASTER_KEY',
      'Cloudflare management and connector authorities must be separate credentials',
      'dedicated Explorer QA tunnel create/reuse did not converge to one exact identity',
      'connector token claims do not match the dedicated Explorer QA tunnel/account',
      'dedicated Explorer QA tunnel has shared or ambiguous ingress',
      'Explorer QA DNS does not target the selected dedicated tunnel',
      'protected proxies ingress topology is not the authorized immutable baseline',
      'protected proxies ingress or unrelated DNS identity changed during Explorer QA deployment',
      'Validated the pinned Explorer QA SSH host identity',
      'tunnelId,',
      'tunnelTokenSecret,',
      'MEDIA_PUBLIC_IPV4:',
      "addressMode: 'direct'",
      'AGENTLIB_URL=',
      'Explorer did not load AgentLib bytes from a verified immutable runtime package',
      'loaded runtime identity at $EXPECTED_AGENTLIB_COMMIT',
      "agent: 'AchillesIDE/explorer'",
      "'browser-auth'",
      "'agent-mcp'",
      "'user-admin'",
      "'workspace-assets'",
      "'blob-transfer'",
      "'marketplace-ui'",
      "'webchat'",
      'const target = "/workspace/.ploinky"',
      'Ploinky authority directory has the wrong owner',
      'STAGED_EDGE_DESIRED="/workspace/.ploinky/.explorer-qa-edge-desired.json"',
      'const target = "/workspace/.ploinky/edge-desired.json"',
      'staged edge desired file has the wrong owner',
      'Cloudflare mode: cloudflare',
      'Cloudflare management: api-managed',
      'Cloudflare publication: ready',
      'Cloudflare connector: running',
      'Tracked agents: 16',
      'Running agents: 16',
      'QA_READY_STREAK',
      'QA_TERMINAL_FAILURE',
      'for _ in $(seq 1 180); do',
      'no-wait failure ${status.repoName}/${status.shortAgent}',
      'a no-wait agent reached a terminal startup failure',
      'timed out waiting for stable 16/16 Explorer QA admission',
      'dedicated persistent `%s` tunnel `%s`, ingress, and DNS API-managed by Ploinky',
      '"${PUBLIC_URL%/}/auth/login?agent=explorer"',
      '"${PUBLIC_URL%/}/auth/login?agent=webAssist"',
      'data-auth-login-form',
      "mismatchBody?.error !== 'auth_route_context_mismatch'",
      'Public edge returned the host-bound Explorer login and rejected a WebAssist selector switch.',
      'Dedicated Explorer QA tunnel id=',
      'EXPLORER_QA_DNS_RECORD_ID=',
      'destroy-explorer-qa.yml',
      'SOUL_GATEWAY_WORKSPACE:',
      'SOUL_GATEWAY_ROUTER_PORT:',
      'refusing to operate on the production Soul Gateway workspace',
      'protected Soul Gateway became unhealthy during QA deployment',
      'The inner graceful stop failed; proving the outer Box stopped',
      'Ploinky Box: stopped',
      'the Box remained running or ambiguous after the degraded stop',
      'inspect_outer_box_status() {',
      'createBoxSupervisor().inspectBoxStatus()',
      'process.stdout.write(formatBoxStatus(status))',
      'BOX_STATUS="$(inspect_outer_box_status)"',
      'STOPPED_BOX_STATUS="$(inspect_outer_box_status)"',
      "[ \"$BOX_PATH_HASH\" != '7a31ab7775eb' ]",
      'QA_VOLUME_ROLES=(workspace containers ploinky-deps)',
      'io.assistos.ploinky-box.path-hash',
      'Exact prior Explorer QA deployment cleanup verified',
      "target !== '/home/admin/explorerQaWorkspace'",
      'snapshot_protected_resources()',
      'Protected host resource identities remained unchanged',
    ],
  },
  {
    file: '.github/workflows/deploy-skills-explorer.yml',
    name: 'Deploy Skills Explorer',
    expected: [
      'DEFAULT_LOCAL_LLM_IMAGE:',
      'public-services/soul-gateway-health/',
      'default local LLM image architecture=',
      'Provision Skills Explorer Host workflow first',
      'https://github.com/AssistOS-AI/ploinky.git',
      'https://github.com/AssistOS-AI/AchillesAgentLib.git',
      '--repo-branch "proxies=${PROXIES_BRANCH:-main}"',
      '--repo-branch "webmeetInfra=main"',
      '${PUBLIC_URL%/}/dashboard',
    ],
  },
];

const SHARED_DEPLOYMENT_CONTRACT = [
  'workflow_dispatch:',
  'permissions:',
  'contents: read',
  'export PLOINKY_WORKSPACE_ROOT="$WORK_DIR"',
  '- name: Create summary',
  '- name: Cleanup',
];

const STALE_COMPONENT_ENDPOINTS = [
  /127\.0\.0\.1:8082/,
  /livekit-skills\.axiologic\.dev/,
  /web-apps\/apps\/api\/documents\/api\.js/,
  /base-agent-additional-server\/onlyOffice/,
];

for (const workflow of WORKFLOWS) {
  test(`${workflow.name} preserves deployment behavior without a component route inventory`, () => {
    const source = fs.readFileSync(path.join(ROOT, workflow.file), 'utf8');

    assert.match(source, new RegExp(`^name: ${workflow.name}$`, 'm'));
    assert.equal(source.includes('\t'), false, 'workflow YAML must not contain tabs');
    assert.equal(source.endsWith('\n'), true, 'workflow YAML must end with a newline');

    for (const required of [...SHARED_DEPLOYMENT_CONTRACT, ...workflow.expected]) {
      assert.equal(source.includes(required), true, `missing restored workflow contract: ${required}`);
    }
    for (const staleEndpoint of STALE_COMPONENT_ENDPOINTS) {
      assert.doesNotMatch(source, staleEndpoint);
    }
    if (workflow.file.endsWith('deploy-explorer-qa.yml')) {
      assert.doesNotMatch(source, /--branch-fallback|--repo-branch|--reset-repos/);
      assert.doesNotMatch(source, /deleteTunnelOnTeardown|create-managed-tunnel/);
      assert.doesNotMatch(source, /BOX_STATUS="\$\("\$PLOINKY" status\)"/);
    } else {
      assert.match(source, /--reset-repos/);
    }

    assert.equal(source.match(/<< ?'REMOTE'/g)?.length, 1, 'expected one remote deployment heredoc');
    assert.equal(source.match(/^          REMOTE$/gm)?.length, 1, 'expected one closed remote deployment heredoc');
  });
}

test('Explorer QA destroy removes only its Ploinky-owned Cloudflare publication', () => {
  const source = fs.readFileSync(
    path.join(ROOT, '.github/workflows/destroy-explorer-qa.yml'),
    'utf8',
  );

  for (const required of [
    "SSH_USER: 'admin'",
    "SSH_HOST: '45.136.70.141'",
    "SSH_ED25519_FINGERPRINT: 'SHA256:pcVG+7QFbfi3Ojn3LeveNutqCWaTOIlgek1o3GKD/KA'",
    "WORKSPACE: 'explorerQaWorkspace'",
    "PLOINKY_BRANCH: 'ploinky-proxy'",
    "DEPLOY_BRANCH: 'ploinky-proxy'",
    "PUBLIC_HOST: 'explorer-qa.axiologic.dev'",
    "CLOUDFLARE_TUNNEL_NAME: 'explorer-qa'",
    '"refs/heads/$PLOINKY_BRANCH:refs/remotes/origin/$PLOINKY_BRANCH"',
    'git -C "$RUNTIME_DIR" merge-base --is-ancestor',
    'The deployed runtime remains authoritative for its immutable edge generation during teardown',
    'hosts: {}',
    'tunnelName,',
    'deleteTunnelOnTeardown: true',
    'const target = "/workspace/.ploinky"',
    'Ploinky authority directory has the wrong owner',
    'STAGED_EDGE_DESIRED="/workspace/.ploinky/.explorer-qa-edge-desired.json"',
    'const target = "/workspace/.ploinky/edge-desired.json"',
    'staged edge desired file has the wrong owner',
    'Cloudflare mode: local-only',
    'Cloudflare connector: absent',
    'timed out waiting for Ploinky to remove its Cloudflare publication',
    'Ploinky removed its owned Cloudflare route, DNS record, and managed tunnel',
    'Unrelated Cloudflare tunnels and routes: preserved',
    'inspect_outer_box_status() {',
    'createBoxSupervisor().inspectBoxStatus()',
    'process.stdout.write(formatBoxStatus(status))',
    'BOX_STATUS="$(inspect_outer_box_status)"',
    'printf \'yes\\n\' | "$PLOINKY" destroy',
    'QA_VOLUME_ROLES=(workspace containers ploinky-deps)',
    'io.assistos.ploinky-box.path-hash',
    '"$BOX_ENGINE" volume rm "$volume_name"',
    'QA workspace, nested-container, dependency volumes, and host identity directory were removed',
    "\"$PINNED_BOX_PATH_HASH\" != '7a31ab7775eb'",
    'BOX_INSTANCE" != "ploinky-box-explorerqaworkspace-$PINNED_BOX_PATH_HASH',
    'cleanup_destroy_files() {',
    "REMOTE_ENV_UPLOADED='true'",
  ]) {
    assert.equal(source.includes(required), true, `missing destroy workflow contract: ${required}`);
  }
  assert.doesNotMatch(source, /checkout --detach --force "refs\/remotes\/origin\/\$PLOINKY_BRANCH"/);
  assert.doesNotMatch(source, /EXPLORER_QA_CLOUDFLARE_TUNNEL_(?:TOKEN|ID)/);
  assert.doesNotMatch(source, /tunnelTokenSecret|publication\/explorer-qa-tunnel/);
  assert.doesNotMatch(source, /BOX_STATUS="\$\("\$PLOINKY" status\)"/);
  assert.doesNotMatch(source, /workspace_name|inputs\.workspace_name/);
  assert.doesNotMatch(source, /vars\.EXPLORER_QA_(?:SSH_USER|SSH_HOST|WORKSPACE)/);
  assert.equal(source.match(/ssh-keyscan/g)?.length, 1, 'destroy host key must be scanned only in pinned preflight');
  assert.ok(
    source.indexOf('SSH_ED25519_FINGERPRINT') < source.indexOf('- name: Destroy Explorer QA Box'),
    'destroy target fingerprint must be established before remote mutation',
  );
});

test('Explorer QA workflow rejects unsafe identity and tunnel state before SSH', () => {
  const source = fs.readFileSync(
    path.join(ROOT, '.github/workflows/deploy-explorer-qa.yml'),
    'utf8',
  );

  assert.doesNotMatch(source, /workspace_name|inputs\.workspace_name/);
  assert.doesNotMatch(source, /vars\.EXPLORER_QA_(?:SSH_USER|SSH_HOST|WORKSPACE)/);
  assert.equal(source.match(/ssh-keyscan/g)?.length, 1, 'host key must be scanned only in pinned preflight');
  assert.ok(
    source.indexOf('connector token claims do not match') < source.indexOf('          scp \\'),
    'connector identity must fail before the first SSH transfer',
  );
  assert.ok(
    source.indexOf('SSH_ED25519_FINGERPRINT') < source.indexOf('- name: Reconcile and start Explorer QA Box'),
    'pinned host identity must be established before the remote deployment step',
  );
  assert.match(source, /install -m 600 "\$RUNNER_TEMP\/explorer_qa_known_hosts"/);
});

test('Explorer QA dedicated tunnel provisioning is fail-closed and preserves the shared tunnel', () => {
  const source = fs.readFileSync(
    path.join(ROOT, '.github/workflows/deploy-explorer-qa.yml'),
    'utf8',
  );

  for (const required of [
    "--data '{\"name\":\"explorer-qa\",\"config_src\":\"cloudflare\"}'",
    'named.length !== 1 || named[0]?.id !== selectedId',
    "ingress[0]?.service !== 'http://127.0.0.1:8080'",
    'records[0]?.content !== expectedTarget',
    'config?.config?.ingress ?? config?.ingress ?? []',
    'cleanup_local_files() {',
    'trap cleanup_local_files EXIT',
    "REMOTE_ENV_UPLOADED='true'",
    '"rm -f -- \'$REMOTE_ENV_FILE\'"',
    'echo "::add-mask::$CLOUDFLARE_TUNNEL_TOKEN"',
    'publication/explorer-qa-api',
    'publication/explorer-qa-tunnel',
    'beforeJson !== afterJson',
    'digest(after) !== process.env.PROTECTED_CLOUDFLARE_DIGEST',
    "result.filter((record) => record?.name !== publicHost)",
    "records.filter((record) => record?.name !== process.env.PUBLIC_HOST)",
    'dedicated Explorer QA connector has no active Cloudflare connection',
  ]) {
    assert.equal(source.includes(required), true, `missing dedicated tunnel invariant: ${required}`);
  }
  assert.doesNotMatch(source, /EXPLORER_QA_CLOUDFLARE_TUNNEL_TOKEN/);
  assert.doesNotMatch(source, /cfd_tunnel\/091c4096-d1c8-4dbc-bb12-0c6357431d96(?:\/token|\"\s*,\s*\{\s*method:\s*['\"](?:PUT|POST|DELETE))/);
  assert.doesNotMatch(
    source,
    /^ {11,}(?:NODE|REMOTE)$/gm,
    'workflow heredoc delimiters must normalize to shell column zero',
  );
  assert.equal(
    source.match(/<< ?'(?:NODE|REMOTE)'/g)?.length,
    source.match(/^ {10}(?:NODE|REMOTE)$/gm)?.length,
    'every workflow heredoc must have one runner-compatible closing delimiter',
  );
  assert.ok(
    source.indexOf("REMOTE_ENV_UPLOADED='true'") < source.indexOf('          scp \\\n'),
    'partial remote credential transfers must be cleanup-eligible',
  );
  assert.equal(
    source.match(/config\?\.config\?\.ingress \?\? config\?\.ingress \?\? \[\]/g)?.length,
    2,
    'both existing-tunnel inventories must normalize Cloudflare missing configuration to empty ingress',
  );
});

test('Explorer QA dedicated tunnel validator rejects malformed, shared, ambiguous, and wrong-DNS fixtures', () => {
  const source = fs.readFileSync(
    path.join(ROOT, '.github/workflows/deploy-explorer-qa.yml'),
    'utf8',
  );
  const marker = 'const [listPath, detailPath, configPath, dnsPath, selectedId, created]';
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex > 0, 'dedicated tunnel validator marker must exist');
  const heredocStart = source.lastIndexOf("<<'NODE'\n", markerIndex);
  const scriptStart = heredocStart + "<<'NODE'\n".length;
  const scriptEnd = source.indexOf('\n          NODE', markerIndex);
  assert.ok(heredocStart > 0 && scriptEnd > scriptStart, 'dedicated tunnel validator heredoc must close');
  const script = source.slice(scriptStart, scriptEnd).replace(/^          /gm, '');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-qa-tunnel-validator-'));
  const selectedId = '11111111-2222-4333-8444-555555555555';
  const accountId = 'a'.repeat(32);
  const hostname = 'explorer-qa.axiologic.dev';
  const response = (result) => ({ success: true, result });
  const run = ({
    named = [{ id: selectedId, name: 'explorer-qa' }],
    detail = { id: selectedId, name: 'explorer-qa', deleted_at: null, account_tag: accountId },
    ingress = [],
    dns = [],
    created = 'false',
  } = {}) => {
    const documents = [response(named), response(detail), response({ config: { ingress } }), response(dns)];
    const files = documents.map((document, index) => {
      const file = path.join(temporary, `${index}.json`);
      fs.writeFileSync(file, JSON.stringify(document));
      return file;
    });
    return spawnSync(
      process.execPath,
      ['--input-type=module', '-', ...files, selectedId, created],
      {
        encoding: 'utf8',
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, PUBLIC_HOST: hostname },
        input: script,
      },
    );
  };
  try {
    assert.equal(run({ created: 'true' }).status, 0, 'new empty dedicated tunnel must pass');
    assert.equal(
      run({ ingress: null, created: 'true' }).status,
      0,
      'new dedicated tunnel with no Cloudflare configuration object must pass as empty ingress',
    );
    assert.notEqual(run({ ingress: { unexpected: true } }).status, 0);
    assert.equal(run({
      ingress: [
        { hostname, service: 'http://127.0.0.1:8080' },
        { service: 'http_status:404' },
      ],
      dns: [{
        id: 'dns_1',
        type: 'CNAME',
        name: hostname,
        content: `${selectedId}.cfargotunnel.com`,
        proxied: true,
      }],
    }).status, 0, 'exact reusable dedicated tunnel must pass');
    assert.notEqual(run({ named: [{ id: selectedId }, { id: 'other' }] }).status, 0);
    assert.notEqual(run({ detail: { id: selectedId, name: 'explorer-qa', account_tag: 'b'.repeat(32) } }).status, 0);
    assert.notEqual(run({
      ingress: [
        { hostname: 'unrelated.example.test', service: 'http://127.0.0.1:8080' },
        { service: 'http_status:404' },
      ],
    }).status, 0);
    assert.notEqual(run({
      dns: [{ type: 'CNAME', name: hostname, content: 'wrong.cfargotunnel.com', proxied: true }],
    }).status, 0);
    assert.notEqual(run({ created: 'true', dns: [{ type: 'CNAME' }] }).status, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('Explorer QA credential staging does not use exclusive create on a mktemp file', () => {
  const source = fs.readFileSync(
    path.join(ROOT, '.github/workflows/deploy-explorer-qa.yml'),
    'utf8',
  );
  const start = source.indexOf('CLOUDFLARE_CREDENTIAL_FILE="$(mktemp');
  const end = source.indexOf('STAGED_CREDENTIAL_FILE=', start);
  assert.ok(start > 0 && end > start, 'credential staging block must exist');
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /flag:\s*['"]wx['"]/, 'mktemp already created the credential file');
  assert.match(block, /flag:\s*['"]w['"]/);
});

test('Explorer QA cleanup handles an absent workspace with exact orphan resources', () => {
  const source = fs.readFileSync(
    path.join(ROOT, '.github/workflows/deploy-explorer-qa.yml'),
    'utf8',
  );
  const cleanup = source.slice(
    source.indexOf('declare -a QA_CONTAINER_RECORDS'),
    source.indexOf('mkdir -p "$WORK_DIR"', source.indexOf('declare -a QA_CONTAINER_RECORDS')),
  );
  assert.match(cleanup, /container ls -aq --filter "label=io\.assistos\.ploinky-box\.path-hash=\$BOX_PATH_HASH"/);
  assert.match(cleanup, /volume ls -q --filter "label=io\.assistos\.ploinky-box\.path-hash=\$BOX_PATH_HASH"/);
  assert.match(cleanup, /error\?\.code !== 'ENOENT'/);
  assert.doesNotMatch(cleanup, /rm\s+-rf|rm\s+-fr/, 'cleanup must use the exact guarded Node target');
});

test('Explorer QA cleanup canonicalizes short and full container identities before ambiguity checks', () => {
  const source = fs.readFileSync(
    path.join(ROOT, '.github/workflows/deploy-explorer-qa.yml'),
    'utf8',
  );
  const cleanup = source.slice(
    source.indexOf('canonicalize_container_candidates()'),
    source.indexOf('mkdir -p "$WORK_DIR"', source.indexOf('canonicalize_container_candidates()')),
  );
  assert.match(cleanup, /container inspect "\$candidate" --format '\{\{\.Id\}\}'/);
  assert.match(
    cleanup,
    /\}\s*\| canonicalize_container_candidates "\$engine" \| sort -u/,
    'candidate names, short IDs, and full IDs must collapse to one immutable identity',
  );
  assert.match(cleanup, /QA_CONTAINER_RECORDS\+=\("\$engine\|\$container_id\|\$container_name"\)/);

  const functionEnd = cleanup.indexOf('\n\n          declare -a QA_CONTAINER_RECORDS');
  assert.ok(functionEnd > 0, 'canonicalization function boundary must exist');
  const functionSource = cleanup.slice(0, functionEnd).replace(/^ {10}/gm, '');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-qa-container-id-'));
  try {
    const fakeEngine = path.join(temporary, 'podman');
    fs.writeFileSync(fakeEngine, `#!/bin/sh
set -eu
[ "$1" = container ]
[ "$2" = inspect ]
case "$3" in
  unrelated) printf '%s\\n' 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ;;
  *) printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ;;
esac
`, { mode: 0o700 });
    const run = (candidates) => spawnSync('bash', ['-c', `set -euo pipefail
${functionSource}
printf '%s\\n' "$@" | canonicalize_container_candidates podman | sort -u
`, 'canonicalize-test', ...candidates], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${temporary}:${process.env.PATH}` },
    });
    const duplicate = run([
      '2d9102773f02',
      '2d9102773f0273493f640935623749c4696dcafe0683d539123f4b58624ab0b8',
      'ploinky-box-explorerqaworkspace-7a31ab7775eb',
    ]);
    assert.equal(duplicate.status, 0, duplicate.stderr);
    assert.deepEqual(duplicate.stdout.trim().split('\n'), ['a'.repeat(64)]);

    const ambiguous = run(['2d9102773f02', 'unrelated']);
    assert.equal(ambiguous.status, 0, ambiguous.stderr);
    assert.deepEqual(ambiguous.stdout.trim().split('\n'), ['a'.repeat(64), 'b'.repeat(64)]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
