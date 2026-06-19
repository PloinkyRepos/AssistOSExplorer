import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebAssistSandbox, ensureSiteAku } from './helpers.mjs';
import { appendSessionTurn, updateSessionProfile } from '../src/runtime/update-session.mjs';
import { loadAkuContext } from '../src/runtime/load-aku-context.mjs';

const SITE_ID = 'demo-site';

test('update-session.runtime updates profile and appends turn history', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());

    await ensureSiteAku({
        siteId: SITE_ID,
    });

    const firstResult = await updateSessionProfile({
        siteId: SITE_ID,
        sessionId: 'test-session-1',
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

    const context = await loadAkuContext({
        siteId: SITE_ID,
        sessionId: 'test-session-1',
        message: 'Need API help',
    });

    assert.match(context.sessionProfileText, /Urgent integration timeline/);
    assert.match(context.sessionProfileText, /Alex Builder/);
    assert.match(context.sessionProfileText, /alex@example\.com/);
    assert.match(context.conversationHistoryText, /\*\*user\*\*: Hello/);
    assert.match(context.conversationHistoryText, /\*\*user\*\*: Need API help/);
    assert.match(context.conversationHistoryText, /\*\*agent\*\*: Hi there!/);
    assert.match(context.conversationHistoryText, /\*\*agent\*\*: Happy to help\./);
});

test('loadAkuContext keeps only the last 10 conversation messages', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());

    await ensureSiteAku({
        siteId: SITE_ID,
    });

    for (let index = 1; index <= 7; index += 1) {
        await appendSessionTurn({
            siteId: SITE_ID,
            sessionId: 'history-session',
            userMessage: `user turn ${index}`,
            agentResponse: `agent turn ${index}`,
        });
    }

    const context = await loadAkuContext({
        siteId: SITE_ID,
        sessionId: 'history-session',
        message: 'continue',
    });

    assert.doesNotMatch(context.conversationHistoryText, /user turn 1/);
    assert.doesNotMatch(context.conversationHistoryText, /agent turn 1/);
    assert.doesNotMatch(context.conversationHistoryText, /user turn 2/);
    assert.doesNotMatch(context.conversationHistoryText, /agent turn 2/);
    assert.match(context.conversationHistoryText, /user turn 3/);
    assert.match(context.conversationHistoryText, /agent turn 7/);
});
