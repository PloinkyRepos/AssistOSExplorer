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

for (const [label, fileName, variablePrefix] of [
    ['QA', 'deploy-explorer-qa.yml', 'EXPLORER_QA_'],
    ['production', 'deploy-skills-explorer.yml', ''],
]) {
test(`Explorer ${label} workflow installs and starts the basic repo for Web Publishing`, async () => {
    const workflow = await readWorkflow(fileName);

    assert.match(workflow, /basic_branch:/);
    assert.match(workflow, /BASIC_BRANCH:/);
    assert.match(workflow, /install https:\/\/github\.com\/AssistOS-AI\/basic\.git basic --branch "\$\{BASIC_BRANCH:-main\}"/);
    assert.match(workflow, /"basic:\$\{BASIC_BRANCH:-main\}"/);
    assert.match(workflow, /--repo-branch "basic=\$\{BASIC_BRANCH:-main\}"/);
    assert.doesNotMatch(workflow, /basic\/cloudflared/);
});

test(`Explorer ${label} workflow accepts only Web Publishing inputs for public topology`, async () => {
    const workflow = await readWorkflow(fileName);
    const legacyTokenName = ['CLOUDFLARED', 'TUNNEL', 'TOKEN'].join('_');
    const standaloneLegacyToken = new RegExp(`(^|[^A-Z0-9_])${legacyTokenName}([^A-Z0-9_]|$)`);

    assert.match(workflow, new RegExp(`${variablePrefix}WEB_PUBLISHING_BASE_DOMAIN`));
    assert.match(workflow, new RegExp(`${variablePrefix}WEB_PUBLISHING_CLOUDFLARED_TUNNEL_TOKEN`));
    assert.match(workflow, /WEB_PUBLISHING_CLOUDFLARE_API_TOKEN/);
    assert.match(workflow, /echo "\\\$\$1"/);

    assert.doesNotMatch(workflow, new RegExp(`vars\\.${variablePrefix}ONLYOFFICE_PUBLIC_URL`));
    assert.doesNotMatch(workflow, new RegExp(`vars\\.${variablePrefix}WEBMEET_PUBLIC_LIVEKIT_URL`));
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
    assert.doesNotMatch(workflow, standaloneLegacyToken);
});
}
