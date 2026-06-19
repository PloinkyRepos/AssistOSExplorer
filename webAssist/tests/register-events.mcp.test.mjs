import test from 'node:test';
import assert from 'node:assert/strict';

import { registerEvent } from '../src/mcp/register-events.mjs';
import { createWebAssistSandbox } from './helpers.mjs';
import { ensureSiteAku } from './helpers.mjs';
import { AgenticKnowledgeUnits } from 'achillesAgentLib';
import { resolveSiteDataDir } from '../src/runtime/akuStore.mjs';

const SITE_ID = 'demo-site';

test('register-event appends site-scoped events to visits/events.md', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    await ensureSiteAku({
        siteId: SITE_ID,
    });

    const first = await registerEvent({
        siteId: SITE_ID,
        visitorId: 'visitor-alpha',
        eventType: 'visit',
        referrer: 'https://example.com/start',
        openedChat: true,
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
    });

    assert.equal(second.ok, true);
    assert.equal(second.eventType, 'chat-start');

    const third = await registerEvent({
        siteId: SITE_ID,
        visitorId: 'visitor-beta',
        eventType: 'consent',
        sessionId: 'session-456',
        details: { consentType: 'follow-up' },
    });

    assert.equal(third.ok, true);
    assert.equal(third.eventType, 'consent');

    const akuRootDir = resolveSiteDataDir(SITE_ID);
    const aku = new AgenticKnowledgeUnits({
        rootDir: akuRootDir,
        actor: `webassist/${SITE_ID}`,
    });
    await aku.loadAKU();
    const siteKu = await aku.loadKU('ku_site');
    const events = siteKu.events || [];

    const trackedEvents = events.filter((entry) => entry.event_type !== 'ku_initialized');
    const eventTypes = trackedEvents.map((entry) => entry.event_type);
    assert.ok(eventTypes.includes('visit'));
    assert.ok(eventTypes.includes('chat-start'));
    assert.ok(eventTypes.includes('consent'));
    assert.equal(first.eventType, 'visit');
    assert.equal(second.eventType, 'chat-start');
    assert.equal(third.eventType, 'consent');
    assert.ok(trackedEvents.some((entry) => /visitor-alpha|visitor-beta/.test(entry.metadata?.visitorId || '')));
}); 
