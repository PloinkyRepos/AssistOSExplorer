import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAssistSandbox } from './helpers.mjs';
import { appendSessionTurn, updateSessionProfile } from '../src/runtime/update-session.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';
import { getSessionHistoryFileName } from '../src/constants/datastore.mjs';

const SITE_ID = 'demo-site';

test('update-session.runtime updates profile and appends turn history', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir, siteId: SITE_ID });

    const firstResult = await updateSessionProfile({
        siteId: SITE_ID,
        sessionId: 'test-session-1',
        profiles: ['Developer.md'],
        profileDetails: ['Understands the API basics'],
        contactInformation: {
            name: 'Alex Builder',
        },
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'test-session-1',
        userMessage: 'Hello',
        agentResponse: 'Hi there!',
    });

    assert.equal(firstResult.success, true);

    const secondResult = await updateSessionProfile({
        siteId: SITE_ID,
        sessionId: 'test-session-1',
        profiles: ['Developer.md', 'Developer.md', 'EnterpriseClient.md'],
        profileDetails: ['Understands the API basics', 'Urgent integration timeline'],
        contactInformation: {
            email: 'alex@example.com',
        },
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'test-session-1',
        userMessage: 'Need API help\nASAP',
        agentResponse: 'Happy to help.\nCan you share your timeline?',
    });

    assert.equal(secondResult.success, true);
    assert.equal(secondResult.sessionProfile.contactInformation.name, 'Alex Builder');
    assert.equal(secondResult.sessionProfile.contactInformation.email, 'alex@example.com');

    const historyContent = await fs.readFile(
        path.join(sandbox.dataDir, 'sites', SITE_ID, 'sessions', `${getSessionHistoryFileName('test-session-1')}.md`),
        'utf8'
    );

    assert.match(historyContent, /### 1\. Target Profiles/);
    assert.match(historyContent, /- Developer\.md/);
    assert.match(historyContent, /- EnterpriseClient\.md/);
    assert.match(historyContent, /- Urgent integration timeline/);
    assert.match(historyContent, /### 3\. Contact Information/);
    assert.match(historyContent, /- \*\*name\*\*: Alex Builder/);
    assert.match(historyContent, /- \*\*email\*\*: alex@example\.com/);
    assert.match(historyContent, /### 5\. History/);
    assert.match(historyContent, /- \*\*User\*\*: Hello/);
    assert.match(historyContent, /- \*\*User\*\*: Need API help/);
    assert.match(historyContent, /  ASAP/);
    assert.match(historyContent, /- \*\*Agent\*\*: Happy to help\./);
    assert.match(historyContent, /  Can you share your timeline\?/);
});
