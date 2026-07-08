import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../../manifest.json');

function readManifest() {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function allEnableEntries(manifest) {
    const topLevel = Array.isArray(manifest.enable) ? manifest.enable : [];
    const profileEntries = Object.values(manifest.profiles || {})
        .flatMap((profile) => Array.isArray(profile.enable) ? profile.enable : []);
    return [...topLevel, ...profileEntries].map((entry) => JSON.stringify(entry));
}

test('cloudflared is not enabled by Explorer default startup', () => {
    const manifest = readManifest();
    const topLevelEnable = Array.isArray(manifest.enable) ? manifest.enable : [];
    const defaultEnable = Array.isArray(manifest.profiles?.default?.enable)
        ? manifest.profiles.default.enable
        : [];

    assert.equal(topLevelEnable.some((entry) => JSON.stringify(entry).includes('basic/cloudflared')), false);
    assert.equal(defaultEnable.some((entry) => JSON.stringify(entry).includes('basic/cloudflared')), false);
});

test('cloudflared is enabled only by Explorer prod profile', () => {
    const manifest = readManifest();
    const prodEnable = manifest.profiles?.prod?.enable || [];

    assert.deepEqual(prodEnable, [
        'basic/cloudflared global no-wait'
    ]);

    const allEntries = allEnableEntries(manifest)
        .filter((entry) => entry.includes('basic/cloudflared'));
    assert.deepEqual(allEntries, [
        JSON.stringify('basic/cloudflared global no-wait')
    ]);
});

test('cloudflared Settings entry is admin-only and points at the Explorer plugin', () => {
    const manifest = readManifest();
    const entry = (manifest.ideSettings || []).find((item) => item.key === 'cloudflared');

    assert.ok(entry);
    assert.equal(entry.label, 'Cloudflare Tunnel');
    assert.equal(entry.scope, 'workspace');
    assert.equal(entry.pluginKey, 'explorer/cloudflared-settings');
    assert.equal(entry.settingsComponent, 'cloudflared-settings');
    assert.equal(entry.adminOnly, true);
});
