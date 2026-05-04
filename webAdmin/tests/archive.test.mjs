import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAdminSandbox } from './helpers.mjs';
import { action } from '../skills/archive/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

test('archive skill moves session and lead files to data/archive', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const result = await action({
        promptText: JSON.stringify({
            sessionIds: ['dev-session'],
            target: 'all',
        }),
    });

    assert.equal(typeof result, 'string');
    assert.match(result, /Archive completed\./);
    assert.match(result, /Archived files: 3/);

    const activeProfile = path.join(sandbox.dataDir, 'sessions', 'dev-session-profile.md');
    const activeHistory = path.join(sandbox.dataDir, 'sessions', 'dev-session-history.md');
    const activeLead = path.join(sandbox.dataDir, 'leads', 'dev-session-lead.md');

    const archivedProfile = path.join(sandbox.dataDir, 'archive', 'sessions', 'dev-session-profile.md');
    const archivedHistory = path.join(sandbox.dataDir, 'archive', 'sessions', 'dev-session-history.md');
    const archivedLead = path.join(sandbox.dataDir, 'archive', 'leads', 'dev-session-lead.md');

    assert.equal(await exists(activeProfile), false);
    assert.equal(await exists(activeHistory), false);
    assert.equal(await exists(activeLead), false);

    assert.equal(await exists(archivedProfile), true);
    assert.equal(await exists(archivedHistory), true);
    assert.equal(await exists(archivedLead), true);
});

test('archive skill silently skips files that do not exist', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const result = await action({
        promptText: JSON.stringify({
            sessionIds: ['legacy-session', 'missing-session'],
            target: 'lead',
        }),
    });

    assert.equal(typeof result, 'string');
    assert.match(result, /Archive completed\./);
    assert.match(result, /Target: lead/);
    assert.match(result, /Archived files: 1/);
    assert.doesNotMatch(result, /Missing files:/);
    assert.doesNotMatch(result, /Missing:/);

    assert.equal(await exists(path.join(sandbox.dataDir, 'leads', 'legacy-session-lead.md')), false);
    assert.equal(await exists(path.join(sandbox.dataDir, 'archive', 'leads', 'legacy-session-lead.md')), true);
});

test('archive skill supports target visitors to move visitors.log', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const visitorsLogPath = path.join(sandbox.dataDir, 'visitors.log');
    await fs.writeFile(visitorsLogPath, '{"timestamp":"2026-05-04T10:00:00Z","visitorId":"v-1"}\n', 'utf8');

    const result = await action({
        promptText: JSON.stringify({
            target: 'visitors',
        }),
    });

    assert.equal(typeof result, 'string');
    assert.match(result, /Archive completed\./);
    assert.match(result, /Target: visitors/);
    assert.match(result, /Archived files: 1/);
    assert.match(result, /visitors\.log/);

    assert.equal(await exists(visitorsLogPath), false);
    assert.equal(await exists(path.join(sandbox.dataDir, 'archive', 'visitors.log')), true);
});

test('archive skill reports already archived visitors.log', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const archiveDir = path.join(sandbox.dataDir, 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    const archivedVisitorsPath = path.join(archiveDir, 'visitors.log');
    await fs.writeFile(archivedVisitorsPath, '{"timestamp":"2026-05-04T10:00:00Z","visitorId":"v-1"}\n', 'utf8');

    const result = await action({
        promptText: JSON.stringify({
            target: 'visitors',
        }),
    });

    assert.equal(typeof result, 'string');
    assert.match(result, /Already archived files: 1/);
    assert.match(result, /Already archived:/);
    assert.match(result, /visitors\.log/);
});
