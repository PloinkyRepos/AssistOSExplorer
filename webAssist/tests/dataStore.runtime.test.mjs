import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    initializeWebAssistDataRoot,
    resolveDataRoot,
    resolveSiteAkuDir,
    resolveSiteDataDir,
    resolveWebAssistDataRoot,
} from '../src/runtime/akuStore.mjs';

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('data directory resolves directly from WEBASSIST_DATA_ROOT', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const dataRoot = path.join(sandboxRoot, 'webassist-data', 'data');
    await fs.mkdir(dataRoot, { recursive: true });

    const originalEnv = process.env.WEBASSIST_DATA_ROOT;
    try {
        process.env.WEBASSIST_DATA_ROOT = dataRoot;

        assert.equal(resolveWebAssistDataRoot(), dataRoot);
        assert.equal(resolveDataRoot(), dataRoot);
        assert.equal(resolveSiteDataDir('demo-site'), path.join(dataRoot, 'sites', 'demo-site'));
        assert.equal(resolveSiteAkuDir('demo-site'), path.join(dataRoot, 'sites', 'demo-site', '.aku'));
    } finally {
        if (originalEnv !== undefined) {
            process.env.WEBASSIST_DATA_ROOT = originalEnv;
        } else {
            delete process.env.WEBASSIST_DATA_ROOT;
        }
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});

test('throws when WEBASSIST_DATA_ROOT is not set', () => {
    const originalEnv = process.env.WEBASSIST_DATA_ROOT;
    try {
        delete process.env.WEBASSIST_DATA_ROOT;
        assert.throws(
            () => resolveWebAssistDataRoot(),
            /WEBASSIST_DATA_ROOT is required/
        );
    } finally {
        if (originalEnv !== undefined) {
            process.env.WEBASSIST_DATA_ROOT = originalEnv;
        }
    }
});

test('throws when the configured webAssist data directory is missing', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const originalEnv = process.env.WEBASSIST_DATA_ROOT;
    try {
        process.env.WEBASSIST_DATA_ROOT = path.join(sandboxRoot, 'missing', 'data');
        assert.throws(
            () => resolveWebAssistDataRoot(),
            /webAssist data directory does not exist/
        );
    } finally {
        if (originalEnv !== undefined) {
            process.env.WEBASSIST_DATA_ROOT = originalEnv;
        } else {
            delete process.env.WEBASSIST_DATA_ROOT;
        }
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});

test('application startup creates the planned data child for fresh host and container storage roots', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-fresh-storage-'));
    const manifest = JSON.parse(await fs.readFile(path.join(AGENT_ROOT, 'manifest.json'), 'utf8'));
    const storage = manifest.runtime.resources.persistentStorage;
    const dataRootTemplate = manifest.runtime.resources.env.WEBASSIST_DATA_ROOT;
    const originalDataRoot = process.env.WEBASSIST_DATA_ROOT;
    const cases = [
        {
            name: 'host sandbox',
            persistentRoot: path.join(sandboxRoot, 'workspace', '.data', storage.key),
        },
        {
            name: 'container mount',
            persistentRoot: path.join(sandboxRoot, storage.containerPath.replace(/^\/+/, '')),
        },
    ];

    try {
        for (const storageCase of cases) {
            await fs.mkdir(storageCase.persistentRoot, { recursive: true });
            const dataRoot = dataRootTemplate.replace('{{STORAGE_CONTAINER_PATH}}', storageCase.persistentRoot);
            process.env.WEBASSIST_DATA_ROOT = dataRoot;

            await assert.rejects(fs.access(dataRoot), undefined, `${storageCase.name} data child should start absent`);
            await initializeWebAssistDataRoot();

            assert.equal((await fs.stat(dataRoot)).isDirectory(), true, `${storageCase.name} data child should be created`);
            assert.equal(resolveWebAssistDataRoot(), path.resolve(dataRoot));
        }
    } finally {
        if (originalDataRoot !== undefined) {
            process.env.WEBASSIST_DATA_ROOT = originalDataRoot;
        } else {
            delete process.env.WEBASSIST_DATA_ROOT;
        }
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});

test('data-root initialization has no workspace-root fallback or migration', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-no-migration-'));
    const legacyRoot = path.join(sandboxRoot, 'webassist-data');
    const originalDataRoot = process.env.WEBASSIST_DATA_ROOT;
    const originalWorkspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT;
    try {
        await fs.mkdir(legacyRoot, { recursive: true });
        await fs.writeFile(path.join(legacyRoot, 'legacy.txt'), 'legacy', 'utf8');
        delete process.env.WEBASSIST_DATA_ROOT;
        process.env.PLOINKY_WORKSPACE_ROOT = sandboxRoot;

        await assert.rejects(
            initializeWebAssistDataRoot(),
            /WEBASSIST_DATA_ROOT is required/
        );
        assert.equal(await fs.readFile(path.join(legacyRoot, 'legacy.txt'), 'utf8'), 'legacy');
    } finally {
        if (originalDataRoot !== undefined) process.env.WEBASSIST_DATA_ROOT = originalDataRoot;
        else delete process.env.WEBASSIST_DATA_ROOT;
        if (originalWorkspaceRoot !== undefined) process.env.PLOINKY_WORKSPACE_ROOT = originalWorkspaceRoot;
        else delete process.env.PLOINKY_WORKSPACE_ROOT;
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});

test('data-root initialization rejects a symlinked managed persistence root without writing outside it', async (t) => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-symlink-root-'));
    t.after(async () => fs.rm(sandboxRoot, { recursive: true, force: true }));
    const workspaceRoot = path.join(sandboxRoot, 'workspace');
    const outsideRoot = path.join(sandboxRoot, 'outside');
    const managedRoot = path.join(workspaceRoot, '.data', 'webAssist');
    const originalDataRoot = process.env.WEBASSIST_DATA_ROOT;
    await fs.mkdir(path.dirname(managedRoot), { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.symlink(outsideRoot, managedRoot);

    try {
        process.env.WEBASSIST_DATA_ROOT = path.join(managedRoot, 'data');
        await assert.rejects(
            initializeWebAssistDataRoot(),
            /non-symlink directory/
        );
        await assert.rejects(fs.access(path.join(outsideRoot, 'data')));
    } finally {
        if (originalDataRoot !== undefined) process.env.WEBASSIST_DATA_ROOT = originalDataRoot;
        else delete process.env.WEBASSIST_DATA_ROOT;
    }
});
