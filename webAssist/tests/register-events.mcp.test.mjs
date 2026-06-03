import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { registerEvent } from '../src/mcp/register-events.mjs';
import { createWebAssistSandbox } from './helpers.mjs';

const SITE_ID = 'demo-site';

test('register-event appends site-scoped events to visits/events.md', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());

    const first = await registerEvent({
        siteId: SITE_ID,
        visitorId: 'visitor-alpha',
        eventType: 'visit',
        referrer: 'https://example.com/start',
        openedChat: true,
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
    });

    assert.equal(first.ok, true);
    assert.equal(first.siteId, SITE_ID);
    assert.equal(first.visitorId, 'visitor-alpha');
    assert.equal(first.eventType, 'visit');
    assert.equal(first.logPath, 'visits/events.md');

    const second = await registerEvent({
        siteId: SITE_ID,
        visitorId: 'visitor-alpha',
        eventType: 'chat-start',
        sessionId: 'session-123',
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
    });

    assert.equal(second.ok, true);
    assert.equal(second.eventType, 'chat-start');

    const third = await registerEvent({
        siteId: SITE_ID,
        visitorId: 'visitor-beta',
        eventType: 'consent',
        sessionId: 'session-456',
        details: { consentType: 'follow-up' },
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
    });

    assert.equal(third.ok, true);
    assert.equal(third.eventType, 'consent');

    const eventsFile = path.join(sandbox.dataDir, 'sites', SITE_ID, 'visits', 'events.md');
    const content = await fs.readFile(eventsFile, 'utf8');

    assert.match(content, /- \*\*Event Type\*\*: visit/);
    assert.match(content, /- \*\*Event Type\*\*: chat-start/);
    assert.match(content, /- \*\*Event Type\*\*: consent/);
    assert.match(content, /- \*\*Visitor ID\*\*: visitor-alpha/);
    assert.match(content, /- \*\*Visitor ID\*\*: visitor-beta/);
    assert.match(content, /- \*\*Session ID\*\*: session-123/);
    assert.match(content, /- \*\*Session ID\*\*: session-456/);
    assert.match(content, /- \*\*Opened Chat\*\*: yes/);
});
