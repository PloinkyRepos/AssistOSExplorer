import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    resolveDataDir,
    resolveSiteDataDir,
} from '../src/runtime/akuStore.mjs';

test('default data directory resolves to PLOINKY_WORKSPACE_ROOT/webassist-data', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const workspacePath = path.join(sandboxRoot, 'workspace');
    const expectedDataDir = path.join(workspacePath, 'webassist-data');
    await fs.mkdir(expectedDataDir, { recursive: true });

    const originalEnv = process.env.PLOINKY_WORKSPACE_ROOT;
    try {
        process.env.PLOINKY_WORKSPACE_ROOT = workspacePath;

        assert.equal(resolveDataDir('/ignored-agent-root'), expectedDataDir);
        assert.equal(resolveSiteDataDir(expectedDataDir, 'demo-site'), path.join(expectedDataDir, 'sites', 'demo-site'));
    } finally {
        if (originalEnv !== undefined) {
            process.env.PLOINKY_WORKSPACE_ROOT = originalEnv;
        } else {
            delete process.env.PLOINKY_WORKSPACE_ROOT;
        }
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});

test('throws when PLOINKY_WORKSPACE_ROOT is not set', async () => {
    const originalEnv = process.env.PLOINKY_WORKSPACE_ROOT;
    try {
        delete process.env.PLOINKY_WORKSPACE_ROOT;
        assert.throws(
            () => resolveDataDir('/ignored-agent-root'),
            /PLOINKY_WORKSPACE_ROOT is required/
        );
    } finally {
        if (originalEnv !== undefined) {
            process.env.PLOINKY_WORKSPACE_ROOT = originalEnv;
        }
    }
});

test('throws when default webassist-data directory is missing', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const workspacePath = path.join(sandboxRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    const originalEnv = process.env.PLOINKY_WORKSPACE_ROOT;
    try {
        process.env.PLOINKY_WORKSPACE_ROOT = workspacePath;
        assert.throws(
            () => resolveDataDir('/ignored-agent-root'),
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

test('explicit data directory override still wins', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const explicitDataDir = path.join(sandboxRoot, 'custom-data');

    try {
        assert.equal(resolveDataDir('/ignored-agent-root', explicitDataDir), explicitDataDir);
    } finally {
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});
