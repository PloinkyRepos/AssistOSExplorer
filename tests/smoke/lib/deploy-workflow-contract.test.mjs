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
      "PUBLIC_HOST: 'explorer-qa.axiologic.dev'",
      'BRANCH_ARGS+=(--repo-branch "$repository_name=$DEPLOY_BRANCH")',
      '--branch-fallback fail',
      "'AchillesIDE|https://github.com/AssistOS-AI/AssistOSExplorer.git'",
      "'webmeetInfra|https://github.com/AssistOS-AI/webmeetInfra.git'",
      "'UmamiAgent|https://github.com/AssistOS-AI/UmamiAgent.git'",
      "'AchillesCLI|https://github.com/AssistOS-AI/AchillesCLI.git'",
      "'copilot-agents|https://github.com/AssistOS-AI/copilot-agents.git'",
      "'proxies|https://github.com/AssistOS-AI/proxies.git'",
      "'basic|https://github.com/AssistOS-AI/basic.git'",
      "'container-image-builds|https://github.com/AssistOS-AI/container-image-builds.git'",
      "CLOUDFLARE_TUNNEL_NAME: 'explorer-qa'",
      "CLOUDFLARE_API_SECRET_HANDLE: 'publication/explorer-qa-api'",
      'EXPLORER_QA_CLOUDFLARE_API_TOKEN',
      'EXPLORER_QA_CLOUDFLARE_ACCOUNT_ID',
      'EXPLORER_QA_CLOUDFLARE_ZONE_ID',
      'tunnelName,',
      'deleteTunnelOnTeardown: true',
      "agent: 'AchillesIDE/explorer'",
      'const target = "/workspace/.ploinky"',
      'Ploinky authority directory has the wrong owner',
      'STAGED_EDGE_DESIRED="/workspace/.ploinky/.explorer-qa-edge-desired.json"',
      'const target = "/workspace/.ploinky/edge-desired.json"',
      'staged edge desired file has the wrong owner',
      'Cloudflare mode: cloudflare',
      'Cloudflare management: api-managed',
      'Cloudflare publication: ready',
      'Cloudflare connector: running',
      'tunnel, ingress, and DNS API-managed by Ploinky',
      '"${PUBLIC_URL%/}/dashboard"',
      'SOUL_GATEWAY_WORKSPACE:',
      'SOUL_GATEWAY_ROUTER_PORT:',
      'refusing to operate on the production Soul Gateway workspace',
      'protected Soul Gateway became unhealthy during QA deployment',
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
  '--reset-repos',
  '"$PLOINKY" status',
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
      assert.doesNotMatch(source, /EXPLORER_QA_CLOUDFLARE_TUNNEL_(?:TOKEN|ID)/);
      assert.doesNotMatch(source, /tunnelTokenSecret|publication\/explorer-qa-tunnel/);
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
    '"$PLOINKY" stop',
    '"refs/heads/$PLOINKY_BRANCH:refs/remotes/origin/$PLOINKY_BRANCH"',
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
    'Ploinky removed its owned Cloudflare route, DNS record, and managed tunnel',
    'Unrelated Cloudflare tunnels and routes: preserved',
    'printf \'yes\\n\' | "$PLOINKY" destroy',
    'Named workspace, nested-container, and dependency volumes were retained',
  ]) {
    assert.equal(source.includes(required), true, `missing destroy workflow contract: ${required}`);
  }
  assert.doesNotMatch(source, /EXPLORER_QA_CLOUDFLARE_TUNNEL_(?:TOKEN|ID)/);
  assert.doesNotMatch(source, /tunnelTokenSecret|publication\/explorer-qa-tunnel/);
});
