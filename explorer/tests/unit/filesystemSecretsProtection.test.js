import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { createCacheHelpers, isProtectedSecretName, isProtectedSecretPath } from '../../utils/filesystem-utils.mjs';
import { createWorkspaceSearch } from '../../utils/server/workspace-search.mjs';

const minimatch = (value, pattern) => value === pattern;

async function withTempDir(run) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'explorer-secrets-'));
    try {
        return await run(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

test('secret name helpers detect protected files', () => {
    assert.equal(isProtectedSecretName('.secrets'), true);
    assert.equal(isProtectedSecretName('github.secrets'), true);
    assert.equal(isProtectedSecretName('notes.txt'), false);
    assert.equal(isProtectedSecretPath('/tmp/work/.secrets'), true);
    assert.equal(isProtectedSecretPath('/tmp/work/github.secrets'), true);
    assert.equal(isProtectedSecretPath('/tmp/work/github.secrets.txt'), false);
});

test('directory cache listing filters .secrets files', async () => {
    await withTempDir(async (tempDir) => {
        await fs.writeFile(path.join(tempDir, 'visible.txt'), 'ok', 'utf8');
        await fs.writeFile(path.join(tempDir, '.secrets'), 'hidden', 'utf8');
        await fs.writeFile(path.join(tempDir, 'github.secrets'), 'hidden', 'utf8');

        const helpers = createCacheHelpers({
            readFileContent: (targetPath) => fs.readFile(targetPath, 'utf8'),
            config: { ttlMs: 1000 }
        });

        const entries = await helpers.listDirectoryDetailedWithCache(tempDir);
        assert.deepEqual(
            entries.map((entry) => entry.name),
            ['visible.txt']
        );
    });
});

test('workspace search skips protected secret files', async () => {
    await withTempDir(async (tempDir) => {
        await fs.writeFile(path.join(tempDir, 'visible.txt'), 'alpha token\nneedle\n', 'utf8');
        await fs.writeFile(path.join(tempDir, '.secrets'), 'needle\n', 'utf8');
        await fs.writeFile(path.join(tempDir, 'github.secrets'), 'needle\n', 'utf8');

        const search = createWorkspaceSearch({
            fs,
            path,
            readline,
            minimatch,
            workspaceRoot: tempDir,
            validatePath: async (value) => value,
            getAllowedDirectories: () => [tempDir],
            readFileWithCache: async (targetPath) => ({
                content: await fs.readFile(targetPath, 'utf8'),
                stats: await fs.stat(targetPath)
            }),
            writeFileContent: (targetPath, content) => fs.writeFile(targetPath, content, 'utf8'),
            cacheConfig: { maxFileSizeBytes: 1024 * 1024 },
            indexDirectory: async (currentPath) => {
                const entries = await fs.readdir(currentPath, { withFileTypes: true });
                return entries.map((entry) => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
                }));
            },
            structureIndex: new Map(),
            dirIndexTtlMs: 1000,
            defaultExcludes: [],
            maxTextSearchFileBytes: 1024 * 1024
        });

        const fileResults = await search.searchFilesWithinWorkspace(tempDir, {
            pattern: 'secrets',
            maxResults: 20,
            excludePatterns: []
        });
        assert.deepEqual(fileResults.results, []);

        const textResults = await search.searchTextWithinWorkspace(tempDir, {
            query: 'needle',
            maxResults: 20,
            excludePatterns: []
        });
        assert.deepEqual(
            textResults.results.map((entry) => entry.path),
            ['/visible.txt']
        );
    });
});
