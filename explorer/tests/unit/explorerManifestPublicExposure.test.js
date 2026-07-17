import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function readManifest() {
    return JSON.parse(await fs.readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
}

test('Explorer v5 manifest has no agent-owned edge publication hooks', async () => {
    const manifest = await readManifest();
    const profiles = manifest.profiles || {};
    const profile = profiles.default;

    assert.deepEqual(Object.keys(profiles), ['default']);
    assert.ok(profile, 'default profile should exist');

    assert.equal(Object.hasOwn(profile, 'enable'), false);
    assert.equal(Object.hasOwn(profile, 'configProviders'), false);
});

test('Explorer v5 manifest contains no removed publication contract', async () => {
    const manifest = await readManifest();
    const serialized = JSON.stringify(manifest);

    // The basic repository remains required by WebTTY. It is not an edge owner.
    assert.equal(manifest.repos?.basic, 'https://github.com/AssistOS-AI/basic.git');
    const removedAgentNames = ['web', 'publishing'].join('-') + '|' + ['cloud', 'flared'].join('');
    const removedOnlyOfficePrefix = ['ONLYOFFICE', '(?:PUBLIC|INTERNAL|CALLBACK_BASE)', 'URL'].join('_');
    const removedWebMeetPrefix = ['WEBMEET', '[A-Z0-9_]*', 'LIVEKIT', '[A-Z0-9_]*'].join('_');
    assert.doesNotMatch(serialized, new RegExp(removedAgentNames, 'i'));
    assert.doesNotMatch(serialized, new RegExp(removedOnlyOfficePrefix));
    assert.doesNotMatch(serialized, new RegExp(removedWebMeetPrefix));
    assert.equal(Object.hasOwn(manifest, ['additional', 'Server', 'Port'].join('')), false);
    assert.equal(Object.hasOwn(manifest, ['open', 'Ports'].join('')), false);
});
