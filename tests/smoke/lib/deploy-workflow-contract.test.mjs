import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORKFLOWS = [
  {
    file: '.github/workflows/deploy-explorer-qa.yml',
    name: 'Deploy Explorer QA',
    expected: [
      'SOUL_GATEWAY_WORKSPACE:',
      'SOUL_GATEWAY_ROUTER_PORT:',
      'refusing to operate on the production Soul Gateway workspace',
      'production Soul Gateway still healthy',
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
    ],
  },
];

const SHARED_DEPLOYMENT_CONTRACT = [
  'workflow_dispatch:',
  'permissions:',
  'contents: read',
  'export PLOINKY_WORKSPACE_ROOT="$WORK_DIR"',
  '--repo-branch "proxies=${PROXIES_BRANCH:-main}"',
  '--repo-branch "webmeetInfra=main"',
  '--reset-repos',
  '"$PLOINKY" status',
  '${PUBLIC_URL%/}/dashboard',
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

    assert.equal(source.match(/<< 'REMOTE'/g)?.length, 1, 'expected one remote deployment heredoc');
    assert.equal(source.match(/^          REMOTE$/gm)?.length, 1, 'expected one closed remote deployment heredoc');
  });
}
