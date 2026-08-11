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
    assert.match(source, /const importSequence = \+\+runtimeImportSequence/);
    assert.match(source, /const importVersion = `\$\{runtimeImportCacheBust\}-\$\{importSequence\}-\$\{attempt\}`/);
    assert.match(source, /const moduleUrl = `\$\{safeBase\}\.js\?runtimeImport=\$\{encodeURIComponent\(importVersion\)\}`/);
    assert.match(source, /import\(\/\* webpackIgnore: true \*\/ moduleUrl\)/);
});

test('WebSkel remains an unmodified consumer of preloaded component assets', async () => {
    const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../../shared/libs/webskel/webskel.mjs'),
        'utf8'
    );

    assert.doesNotMatch(source, /Failed to load component asset/);
    assert.match(source, /e\.loadedTemplate \|\| await \(await fetch\(n\)\)\.text\(\)/);
    assert.match(source, /e\.loadedCSSs \|\| \[await \(await fetch\(o\)\)\.text\(\)\]/);
});
