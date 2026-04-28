import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAdminSandbox } from './helpers.mjs';
import { action } from '../skills/manage-owner-info/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

test('manage-owner-info updates standard contact lines', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const configDir = path.join(sandbox.dataDir, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
        path.join(configDir, 'owner.md'),
        'Email: old@example.com\nPhone: 111\n',
        'utf8'
    );

    const updateResult = await action({
        promptText: JSON.stringify({
            email: 'new@example.com',
            meeting: 'https://cal.example.com/meet',
        }),
    });
    assert.equal(typeof updateResult, 'string');
    assert.match(updateResult, /Owner info updated\./);

    const content = await fs.readFile(path.join(configDir, 'owner.md'), 'utf8');
    assert.match(content, /Email: new@example\.com/);
    assert.match(content, /Phone: 111/);
    assert.match(content, /Meeting: https:\/\/cal\.example\.com\/meet/);
});
