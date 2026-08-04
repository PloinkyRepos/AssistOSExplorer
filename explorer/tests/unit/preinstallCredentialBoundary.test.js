import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const explorerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hookPath = path.join(explorerRoot, 'scripts', 'hooks', 'preinstall.sh');
const removedDirectStore = path.join(explorerRoot, 'scripts', 'hooks', 'encrypted-secrets.mjs');

test('Explorer preinstall relies on global-mode cwd without receiving or reconstructing credentials', async () => {
    const source = await fs.readFile(hookPath, 'utf8');

    assert.match(source, /rec\.runMode = 'global'/);
    assert.match(source, /rec\.projectPath = workspaceRoot/);
    assert.doesNotMatch(
        source,
        /PLOINKY_MASTER_KEY|encrypted-secrets\.mjs|createCipheriv|hkdfSync|ploinky (?:var|echo) ASSISTOS_FS_ROOT/,
    );
    await assert.rejects(fs.access(removedDirectStore), { code: 'ENOENT' });
});
