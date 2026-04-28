import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAdminSandbox } from './helpers.mjs';
import { action } from '../skills/update-lead/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

test('update-lead updates lead lifecycle state and rejects invalid cases', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const result = await action({
        promptText: JSON.stringify({
            leadId: 'dev-session-lead.md',
            newStatus: 'contacted',
        }),
    });

    assert.equal(typeof result, 'string');
    assert.match(result, /updated to status contacted/);

    const content = await fs.readFile(
        path.join(sandbox.dataDir, 'leads', 'dev-session-lead.md'),
        'utf8'
    );
    assert.match(content, /- \*\*Status\*\*: contacted/);
    assert.match(content, /- \*\*Created At\*\*: 2026-04-05T09:00:00.000Z/);

    const invalidStatus = await action({
        promptText: JSON.stringify({
            leadId: 'dev-session-lead.md',
            newStatus: 'new',
        }),
    });
    assert.equal(typeof invalidStatus, 'string');
    assert.match(invalidStatus, /Invalid status/);

    const missingLead = await action({
        promptText: JSON.stringify({
            leadId: 'missing.md',
            newStatus: 'invalid',
        }),
    });
    assert.equal(typeof missingLead, 'string');
    assert.match(missingLead, /Lead not found/);
});
