import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAdminSandbox } from './helpers.mjs';
import { action } from '../skills/statistics/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

test('statistics filters sessions and leads by the requested interval', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    await fs.writeFile(
        path.join(sandbox.dataDir, 'visitors.log'),
        [
            JSON.stringify({ timestamp: '2026-04-06T10:00:00.000Z', visitorId: 'visitor-a', source: 'web-assist-chat', version: 1 }),
            JSON.stringify({ timestamp: '2026-04-02T10:00:00.000Z', visitorId: 'visitor-b', source: 'web-assist-chat', version: 1 }),
            JSON.stringify({ timestamp: '2025-01-02T10:00:00.000Z', visitorId: 'visitor-legacy', source: 'web-assist-chat', version: 1 }),
        ].join('\n') + '\n',
        'utf8'
    );

    const referenceDate = new Date('2026-04-06T12:00:00.000Z');
    await fs.utimes(
        path.join(sandbox.dataDir, 'sessions', 'dev-session-profile.md'),
        referenceDate,
        referenceDate
    );
    const oldSessionDate = new Date('2025-10-01T12:00:00.000Z');
    await fs.utimes(
        path.join(sandbox.dataDir, 'sessions', 'legacy-session-profile.md'),
        oldSessionDate,
        oldSessionDate
    );

    const result = await action({
        promptText: JSON.stringify({ interval: 'month' }),
        referenceDate,
    });
    assert.equal(typeof result, 'string');
    assert.match(result, /Statistics computed for interval month\./);
    assert.match(result, /Total Unique Visitors: 3/);
    assert.match(result, /Visitors in Interval: 2/);
    assert.match(result, /Visitors Today: 1/);
    assert.match(result, /Visitors This Week: 2/);
    assert.match(result, /Total Sessions: 1/);
    assert.match(result, /Total Leads: 1/);
    assert.match(result, /Lead Conversion \(Leads\/Visitors\): 50\.0%/);
    assert.match(result, /- Developer: 1/);
    assert.doesNotMatch(result, /EnterpriseClient/);
});
