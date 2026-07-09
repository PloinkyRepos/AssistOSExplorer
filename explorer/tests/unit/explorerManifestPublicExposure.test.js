import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function readManifest() {
    return JSON.parse(await fs.readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
}

function refsAgent(value, expected) {
    if (typeof value === 'string') {
        return value.includes(expected);
    }
    return typeof value?.agent === 'string' && value.agent.includes(expected);
}

test('Explorer default profile uses Web Publishing as blocking public topology provider', async () => {
    const manifest = await readManifest();
    const profiles = manifest.profiles || {};
    const profile = profiles.default;

    assert.deepEqual(Object.keys(profiles), ['default']);
    assert.ok(profile, 'default profile should exist');

    assert.equal(
        (profile.enable || []).some((entry) => refsAgent(entry, 'basic/cloudflared')),
        false,
        'default must not enable the standalone cloudflared agent'
    );

    assert.deepEqual(profile.enable, [
        {
            agent: 'basic/web-publishing global',
            profile: 'default'
        }
    ]);

    assert.deepEqual(profile.configProviders, [
        {
            agent: 'basic/web-publishing global',
            profile: 'default'
        }
    ]);
});

test('Explorer declares Web Publishing support repos and never requests the legacy tunnel var', async () => {
    const manifest = await readManifest();
    const serialized = JSON.stringify(manifest);
    const legacyTokenName = ['CLOUDFLARED', 'TUNNEL', 'TOKEN'].join('_');

    assert.equal(manifest.repos?.basic, 'https://github.com/AssistOS-AI/basic.git');
    assert.equal(
        manifest.repos?.['container-image-builds'],
        'https://github.com/AssistOS-AI/container-image-builds.git'
    );
    assert.match(serialized, /basic\/web-publishing/);
    assert.doesNotMatch(serialized, /basic\/cloudflared/);
    assert.equal(serialized.includes(`"${legacyTokenName}"`), false);
    assert.equal(serialized.includes(legacyTokenName), false);
});
