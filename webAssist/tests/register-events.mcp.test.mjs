import test from 'node:test';
import assert from 'node:assert/strict';

import { registerEvent } from '../src/mcp/register-events.mjs';
import { createWebAssistSandbox, initializeSiteAku } from './helpers.mjs';

const SITE_ID = 'demo-site';

test('register-event appends site-scoped events to the site KU', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    const aku = await initializeSiteAku(sandbox, SITE_ID);

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

    await aku.loadAKU();
    const siteKU = await aku.loadKU('ku_site');
    const events = (siteKU.events || [])
        .filter((event) => ['visit', 'chat-start', 'consent'].includes(event.event_type));

    assert.equal(events.length, 3);
    assert.deepEqual(events.map((event) => event.event_type), ['visit', 'chat-start', 'consent']);
    assert.deepEqual(events.map((event) => event.metadata.visitorId), ['visitor-alpha', 'visitor-alpha', 'visitor-beta']);
    assert.equal(events[1].metadata.sessionId, 'session-123');
    assert.equal(events[2].metadata.sessionId, 'session-456');
    assert.equal(events[0].metadata.openedChat, 'yes');
});
