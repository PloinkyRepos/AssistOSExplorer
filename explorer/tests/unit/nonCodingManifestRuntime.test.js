import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const explorerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(explorerRoot, '..');
const containerImage = 'docker.io/assistos/ploinky-node:24-bookworm-tools';
const containerBackedAgents = [
    'dpuAgent',
    'explorer',
    'gitAgent',
    'multimedia',
    'soplangAgent',
    'tasksAgent',
    'webAssist'
];

test('non-coding Explorer agents remain container-backed without sandbox selectors', async () => {
    for (const agentName of containerBackedAgents) {
        const manifestPath = path.join(repositoryRoot, agentName, 'manifest.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

        assert.equal(manifest.container, containerImage, `${agentName} must retain its container image`);
        assert.equal(
            Object.hasOwn(manifest, 'lite-sandbox'),
            false,
            `${agentName} must not select the host sandbox runtime`
        );
    }
});
