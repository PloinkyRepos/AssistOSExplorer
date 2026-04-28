import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAssistSandbox } from './helpers.mjs';
import { action } from '../skills/book-meeting/src/index.mjs';
import { action as createLeadAction } from '../skills/create-lead/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

test('book-meeting returns the owner configuration and errors on missing config', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    await assert.rejects(
        () => action({
            promptText: JSON.stringify({ sessionId: 'session-without-lead' }),
        }),
        /the current session user does not have a lead! check if user is qualified for a lead then create it/
    );

    await createLeadAction({
        promptText: JSON.stringify({
            sessionId: 'session1',
            contactInfo: { email: 'session1@example.com' },
            profile: 'Developer',
            summary: 'Qualified profile with explicit contact information.',
        }),
    });

    const successResult = await action({
        promptText: JSON.stringify({ sessionId: 'session1' }),
    });
    assert.match(successResult, /Calendar link: https:\/\/cal\.example\.com\/webassist-demo/);

    const configDir = path.join(sandbox.dataDir, 'config');
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.mkdir(configDir, { recursive: true });

    await assert.rejects(
        () => action({
            promptText: JSON.stringify({ sessionId: 'session1' }),
        }),
        /No configuration found/
    );
});
