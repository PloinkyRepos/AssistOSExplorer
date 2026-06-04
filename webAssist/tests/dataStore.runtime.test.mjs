import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
    configureDataStore,
    getConfiguredDataDir,
    resolveDataDir,
    resolveSiteDataDir,
} from '../src/runtime/dataStore.mjs';

test('default data directory resolves to WORKSPACE_PATH/data', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const workspacePath = path.join(sandboxRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });

    const originalEnv = process.env.WORKSPACE_PATH;
    try {
        process.env.WORKSPACE_PATH = workspacePath;

        const expectedDataDir = path.join(workspacePath, 'data');
        assert.equal(resolveDataDir('/ignored-agent-root'), expectedDataDir);
        assert.equal(resolveSiteDataDir(expectedDataDir, 'demo-site'), path.join(expectedDataDir, 'sites', 'demo-site'));

        configureDataStore({ agentRoot: '/ignored-agent-root', siteId: 'demo-site' });
        assert.equal(getConfiguredDataDir(), path.join(expectedDataDir, 'sites', 'demo-site'));
    } finally {
        if (originalEnv !== undefined) {
            process.env.WORKSPACE_PATH = originalEnv;
        } else {
            delete process.env.WORKSPACE_PATH;
        }
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});

test('throws when WORKSPACE_PATH is not set', async () => {
    const originalEnv = process.env.WORKSPACE_PATH;
    try {
        delete process.env.WORKSPACE_PATH;
        assert.throws(
            () => resolveDataDir('/ignored-agent-root'),
            /WORKSPACE_PATH is required/
        );
    } finally {
        if (originalEnv !== undefined) {
            process.env.WORKSPACE_PATH = originalEnv;
        }
    }
});

test('explicit data directory override still wins', async () => {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));
    const explicitDataDir = path.join(sandboxRoot, 'custom-data');

    try {
        assert.equal(resolveDataDir('/ignored-agent-root', explicitDataDir), explicitDataDir);

        configureDataStore({
            agentRoot: '/ignored-agent-root',
            dataDir: explicitDataDir,
            siteId: 'demo-site',
        });
        assert.equal(getConfiguredDataDir(), path.join(explicitDataDir, 'sites', 'demo-site'));
    } finally {
        await fs.rm(sandboxRoot, { recursive: true, force: true });
    }
});
