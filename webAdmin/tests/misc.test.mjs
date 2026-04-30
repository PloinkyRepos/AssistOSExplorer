import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAdminSandbox } from './helpers.mjs';
import { action as leadInfoAction } from '../skills/lead-info/src/index.mjs';
import { action as newsAction } from '../skills/news/src/index.mjs';
import { action as sessionInfoAction } from '../skills/session-info/src/index.mjs';
import { action as statisticsAction } from '../skills/statistics/src/index.mjs';
import { action as updateLeadAction } from '../skills/update-lead/src/index.mjs';
import { action as manageProfileAction } from '../skills/manage-profile/src/index.mjs';
import { action as manageSiteInfoAction } from '../skills/manage-site-info/src/index.mjs';
import { action as manageOwnerInfoAction } from '../skills/manage-owner-info/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

test('lead-info skill returns parsed lead data and related session history', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const result = await leadInfoAction({
        promptText: JSON.stringify({ leadId: 'dev-session-lead.md' }),
    });
    assert.equal(typeof result, 'string');
    assert.match(result, /Lead details loaded for dev-session-lead\./);
    assert.match(result, /Profile: Developer/);
    assert.match(result, /Session ID: dev-session/);
    assert.match(result, /Needs API integration support/);
});

test('news skill returns recent leads, profile details, and session history', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const latestLeadPath = path.join(sandbox.dataDir, 'leads', 'newest-session-lead.md');
    await fs.writeFile(latestLeadPath, `### 1. Lead Info
- **Status**: new
- **Profile**: Developer
- **Session ID**: newest-session
- **Created At**: 2026-04-06T11:30:00.000Z
- **Updated At**: 2026-04-06T11:30:00.000Z

### 2. Contact Info
- **email**: newest@example.com
- **name**: Nova Newest

### 3. Summary
Newest lead for admin news coverage.
`);

    await fs.writeFile(path.join(sandbox.dataDir, 'sessions', 'newest-session-profile.md'), `### 1. Profile
- Developer.md

### 2. Profile Details
- Asked for migration timeline.
- Requested direct implementation support.
`);

    await fs.writeFile(path.join(sandbox.dataDir, 'sessions', 'newest-session-history.md'), `### 1. History
- **User**: Can we migrate this week?
- **Agent**: Yes, we can schedule a migration plan.
- **User**: Please include rollout notes.
- **Agent**: I will include rollout notes.
`);

    const result = await newsAction({
        promptText: JSON.stringify({
            leads: { limit: 2 },
            profileDetails: { limit: 2 },
            sessionHistory: { limit: 2 },
        }),
    });
    assert.equal(typeof result, 'string');
    assert.match(result, /News report ready\./);
    assert.match(result, /Recent leads \(2\/2\):/);
    assert.match(result, /- newest-session-lead\.md/);
    assert.match(result, /Recent profile details \(2\/2\):/);
    assert.match(result, /\[newest-session\] Asked for migration timeline\./);
    assert.match(result, /Recent session history messages \(2\/2\):/);
    assert.match(result, /\[newest-session\] Agent: I will include rollout notes\./);
});

test('session-info returns first 10 messages by default or full history when requested', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const historyPath = path.join(sandbox.dataDir, 'sessions', 'dev-session-history.md');
    await fs.writeFile(historyPath, `### 1. History
- **User**: Message 1
- **Agent**: Message 2
- **User**: Message 3
- **Agent**: Message 4
- **User**: Message 5
- **Agent**: Message 6
- **User**: Message 7
- **Agent**: Message 8
- **User**: Message 9
- **Agent**: Message 10
- **User**: Message 11
- **Agent**: Message 12
`);

    const limitedResult = await sessionInfoAction({
        promptText: JSON.stringify({ sessionId: 'dev-session' }),
    });
    assert.equal(typeof limitedResult, 'string');
    assert.match(limitedResult, /Session details loaded for dev-session\./);
    assert.match(limitedResult, /Session history \(first 10\/10 messages\):/);
    assert.match(limitedResult, /- User: Message 1/);
    assert.doesNotMatch(limitedResult, /Message 11/);

    const fullResult = await sessionInfoAction({
        promptText: JSON.stringify({ sessionId: 'dev-session', includeFullHistory: true }),
    });
    assert.equal(typeof fullResult, 'string');
    assert.match(fullResult, /Session history \(12 total messages\):/);
    assert.match(fullResult, /- Agent: Message 12/);
});

test('news skill rejects legacy top-level limit input', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const result = await newsAction({
        promptText: JSON.stringify({ limit: 2 }),
    });
    assert.equal(result, 'news no longer accepts top-level limit. Use leads/profileDetails/sessionHistory objects.');
});

test('skills return explicit error text for invalid input payloads', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const invalidPrompt = '{invalid-json';
    const skillActions = [
        newsAction,
        statisticsAction,
        leadInfoAction,
        sessionInfoAction,
        updateLeadAction,
        manageProfileAction,
        manageSiteInfoAction,
        manageOwnerInfoAction,
    ];

    for (const execute of skillActions) {
        const result = await execute({ promptText: invalidPrompt });
        assert.equal(typeof result, 'string');
        assert.equal(result.length > 0, true);
    }
});
