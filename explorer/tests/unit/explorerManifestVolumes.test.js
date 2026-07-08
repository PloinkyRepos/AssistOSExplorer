import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('Explorer mounts Ploinky repos for cross-agent settings discovery', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));

    assert.equal(manifest.volumes?.['.ploinky/repos'], '/workspace/.ploinky/repos');
});
