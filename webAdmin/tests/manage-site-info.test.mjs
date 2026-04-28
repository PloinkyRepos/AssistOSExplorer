import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAdminSandbox } from './helpers.mjs';
import { action } from '../skills/manage-site-info/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

test('manage-site-info writes and reads info files', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const writeResult = await action({
        promptText: JSON.stringify({
            fileName: 'overview',
            content: 'Website overview content.',
        }),
    });
    assert.equal(typeof writeResult, 'string');
    assert.match(writeResult, /Created site info file overview\.md\./);

    const infoPath = path.join(sandbox.dataDir, 'info', 'overview.md');
    const stored = await fs.readFile(infoPath, 'utf8');
    assert.match(stored, /Website overview content/);

    const readResult = await action({
        promptText: JSON.stringify({ fileName: 'overview' }),
    });

    assert.equal(typeof readResult, 'string');
    assert.match(readResult, /# overview\.md/);
    assert.match(readResult, /Website overview content/);
});

test('manage-site-info derives filename when missing', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const writeResult = await action({
        promptText: JSON.stringify({
            content: 'Frequently Asked Questions for the Product',
        }),
    });

    assert.equal(typeof writeResult, 'string');
    assert.match(writeResult, /Created:\n- frequently-asked-questions-for-the-product\.md/);
});
