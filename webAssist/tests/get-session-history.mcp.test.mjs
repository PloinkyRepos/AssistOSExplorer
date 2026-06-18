import test from 'node:test';
import assert from 'node:assert/strict';

import { appendSessionTurn, updateSessionProfile } from '../src/runtime/update-session.mjs';
import { getSessionHistory } from '../src/mcp/get-session-history.mjs';
import { createWebAssistSandbox, initializeSiteAku } from './helpers.mjs';

const SITE_ID = 'demo-site';

test('web_cli_history returns parsed session history for existing sessions', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    await initializeSiteAku(sandbox, SITE_ID);

    await updateSessionProfile({
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
        siteId: SITE_ID,
        sessionId: 'history-sess-1',
        profileDetails: ['Interested in API integration'],
    });
    await appendSessionTurn({
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
        siteId: SITE_ID,
        sessionId: 'history-sess-1',
        userMessage: 'Hello there',
        agentResponse: 'Hi! How can I help today?',
    });
    await updateSessionProfile({
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
        siteId: SITE_ID,
        sessionId: 'history-sess-1',
        profileDetails: ['Asks about pricing'],
    });
    await appendSessionTurn({
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
        siteId: SITE_ID,
        sessionId: 'history-sess-1',
        userMessage: 'I need pricing details',
        agentResponse: 'Sure. Which team size are you targeting?',
    });

    const result = await getSessionHistory({
        siteId: SITE_ID,
        sessionId: 'history-sess-1',
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
    });

    assert.equal(result.siteId, SITE_ID);
    assert.equal(result.sessionId, 'history-sess-1');
    assert.equal(result.exists, true);
    assert.equal(result.history.length, 4);
    assert.deepEqual(result.history[0], { role: 'user', message: 'Hello there' });
    assert.deepEqual(result.history[1], { role: 'agent', message: 'Hi! How can I help today?' });
    assert.deepEqual(result.history[2], { role: 'user', message: 'I need pricing details' });
    assert.deepEqual(result.history[3], { role: 'agent', message: 'Sure. Which team size are you targeting?' });
});

test('web_cli_history returns empty history when session file is missing', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());

    const result = await getSessionHistory({
        siteId: SITE_ID,
        sessionId: 'missing-session',
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
    });

    assert.equal(result.siteId, SITE_ID);
    assert.equal(result.sessionId, 'missing-session');
    assert.equal(result.exists, false);
    assert.deepEqual(result.history, []);
});
