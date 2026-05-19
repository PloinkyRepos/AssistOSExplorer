import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('runtime component registry cache-busts presenter module imports', async () => {
    const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../../services/runtime/componentRegistry.js'),
        'utf8'
    );

    assert.match(source, /runtimeImportCacheBust = Date\.now\(\)\.toString\(36\)/);
    assert.match(source, /const moduleUrl = `\$\{safeBase\}\.js\?runtimeImport=\$\{encodeURIComponent\(runtimeImportCacheBust\)\}`/);
    assert.match(source, /import\(\/\* webpackIgnore: true \*\/ moduleUrl\)/);
});
