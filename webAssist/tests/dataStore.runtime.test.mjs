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

test('default data directory resolves to current working directory data folder', async () => {
    const previousCwd = process.cwd();
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webassist-datastore-'));

    try {
        process.chdir(sandboxRoot);

        const expectedDataDir = path.join(sandboxRoot, 'data');
        assert.equal(resolveDataDir('/ignored-agent-root'), expectedDataDir);
        assert.equal(resolveSiteDataDir(expectedDataDir, 'demo-site'), path.join(expectedDataDir, 'sites', 'demo-site'));

        configureDataStore({ agentRoot: '/ignored-agent-root', siteId: 'demo-site' });
        assert.equal(getConfiguredDataDir(), path.join(expectedDataDir, 'sites', 'demo-site'));
    } finally {
        process.chdir(previousCwd);
        await fs.rm(sandboxRoot, { recursive: true, force: true });
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
