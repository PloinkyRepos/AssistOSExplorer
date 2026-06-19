import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveDataRoot, resolveSiteAkuDir, resolveSiteDataDir, resolveWebAssistDataRoot } from '../src/runtime/akuStore.mjs';

test('default data directory resolves to PLOINKY_WORKSPACE_ROOT/webassist-data', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const dataRoot = path.join(sandboxRoot, 'webassist-data');
    await fs.mkdir(dataRoot, { recursive: true });

    const originalEnv = process.env.PLOINKY_WORKSPACE_ROOT;
    try {
        process.env.PLOINKY_WORKSPACE_ROOT = sandboxRoot;

        assert.equal(resolveWebAssistDataRoot(), dataRoot);
        assert.equal(resolveDataRoot(), dataRoot);
        assert.equal(resolveSiteDataDir('demo-site'), path.join(dataRoot, 'sites', 'demo-site'));
        assert.equal(resolveSiteAkuDir('demo-site'), path.join(dataRoot, 'sites', 'demo-site', '.aku'));
    } finally {
        if (originalEnv !== undefined) {
            process.env.PLOINKY_WORKSPACE_ROOT = originalEnv;
        } else {
            delete process.env.PLOINKY_WORKSPACE_ROOT;
        }
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});

test('throws when PLOINKY_WORKSPACE_ROOT is not set', () => {
    const originalEnv = process.env.PLOINKY_WORKSPACE_ROOT;
    try {
        delete process.env.PLOINKY_WORKSPACE_ROOT;
        assert.throws(
            () => resolveWebAssistDataRoot(),
            /PLOINKY_WORKSPACE_ROOT is required/
        );
    } finally {
        if (originalEnv !== undefined) {
            process.env.PLOINKY_WORKSPACE_ROOT = originalEnv;
        }
    }
});

test('throws when webassist-data directory is missing', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const originalEnv = process.env.PLOINKY_WORKSPACE_ROOT;
    try {
        process.env.PLOINKY_WORKSPACE_ROOT = sandboxRoot;
        assert.throws(
            () => resolveWebAssistDataRoot(),
            /webAssist data directory does not exist/
        );
    } finally {
        if (originalEnv !== undefined) {
            process.env.PLOINKY_WORKSPACE_ROOT = originalEnv;
        } else {
            delete process.env.PLOINKY_WORKSPACE_ROOT;
        }
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});
