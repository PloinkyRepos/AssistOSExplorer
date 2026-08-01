import assert from 'node:assert/strict';
import fs from 'node:fs';
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
      'CLOUDFLARE_TUNNEL_ID:',
      "CLOUDFLARE_TUNNEL_SECRET_HANDLE: 'publication/explorer-qa-tunnel'",
      "CLOUDFLARE_API_SECRET_HANDLE: 'publication/explorer-qa-api'",
      'EXPLORER_QA_CLOUDFLARE_API_TOKEN',
      'EXPLORER_QA_CLOUDFLARE_TUNNEL_TOKEN',
      'EXPLORER_QA_CLOUDFLARE_ACCOUNT_ID',
      'EXPLORER_QA_CLOUDFLARE_ZONE_ID',
      'EXPLORER_QA_PLOINKY_MASTER_KEY',
      'Cloudflare management and connector authorities must be separate credentials',
      'active explorer-qa tunnel inventory is absent or ambiguous',
      'connector token claims do not match the selected Explorer QA tunnel/account',
      'Explorer QA tunnel is shared or has ambiguous ingress',
      'Explorer QA DNS is ambiguous or points outside the selected tunnel',
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
      'no-wait failure ${status.repoName}/${status.shortAgent}',
      'a no-wait agent reached a terminal startup failure',
      'timed out waiting for stable 16/16 Explorer QA admission',
      'existing authorized tunnel, ingress, and DNS API-managed by Ploinky',
      '"${PUBLIC_URL%/}/"',
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
  ]) {
    assert.equal(source.includes(required), true, `missing destroy workflow contract: ${required}`);
  }
  assert.doesNotMatch(source, /checkout --detach --force "refs\/remotes\/origin\/\$PLOINKY_BRANCH"/);
  assert.doesNotMatch(source, /EXPLORER_QA_CLOUDFLARE_TUNNEL_(?:TOKEN|ID)/);
  assert.doesNotMatch(source, /tunnelTokenSecret|publication\/explorer-qa-tunnel/);
  assert.doesNotMatch(source, /BOX_STATUS="\$\("\$PLOINKY" status\)"/);
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
    source.indexOf('connector token claims do not match') < source.indexOf('- name: Prepare SSH key'),
    'connector identity must fail before SSH key preparation',
  );
  assert.ok(
    source.indexOf('SSH_ED25519_FINGERPRINT') < source.indexOf('- name: Reconcile and start Explorer QA Box'),
    'pinned host identity must be established before the remote deployment step',
  );
  assert.match(source, /install -m 600 "\$RUNNER_TEMP\/explorer_qa_known_hosts"/);
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
