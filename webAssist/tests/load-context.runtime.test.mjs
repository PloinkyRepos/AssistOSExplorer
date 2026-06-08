import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebAssistSandbox } from './helpers.mjs';
import { appendSessionTurn, updateSessionProfile } from '../src/runtime/update-session.mjs';
import { loadContext } from '../src/runtime/load-context.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';
import { action as createLeadAction } from '../skills/webassist-lead/src/index.mjs';

const SITE_ID = 'demo-site';

test('load-context.runtime loads info, profile definitions, and parsed session state from separate files', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir, siteId: SITE_ID });

    await updateSessionProfile({
        siteId: SITE_ID,
        sessionId: 'sess1',
        profileDetails: ['Asked about API integrations'],
        contactInformation: {
            name: 'Session One',
            email: 'sess1@example.com',
        },
    });
    await createLeadAction({
        promptText: JSON.stringify({
            siteId: SITE_ID,
            sessionId: 'sess1',
            contactInfo: { email: 'sess1@example.com', name: 'Session One' },
            profile: 'Developer',
            mandatoryConditionsSatisfied: true,
            matchExplanation: 'The visitor asked about API integrations and provided contact information.',
            summary: 'Qualified developer profile.',
        }),
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'sess1',
        userMessage: 'First user message',
        agentResponse: 'First agent response',
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'sess1',
        userMessage: 'Second user message',
        agentResponse: 'Second agent response',
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'sess1',
        userMessage: 'Third user message',
        agentResponse: 'Third agent response',
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'sess1',
        userMessage: 'Fourth user message',
        agentResponse: 'Fourth agent response',
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'sess1',
        userMessage: 'Fifth user message',
        agentResponse: 'Fifth agent response',
    });
    await appendSessionTurn({
        siteId: SITE_ID,
        sessionId: 'sess1',
        userMessage: 'Sixth user message',
        agentResponse: 'Sixth agent response',
    });

    const result = await loadContext({
        siteId: SITE_ID,
        sessionId: 'sess1',
    });

    assert.equal(result.siteId, SITE_ID);
    assert.equal(result.siteInfo.length, 2);
    assert.equal(result.profiles.length, 2);
    assert.equal(result.ownerConfig.exists, true);
    assert.equal(result.policyConfig.exists, true);
    assert.equal(result.sessionProfile.isNewSession, false);
    assert.deepEqual(result.sessionProfile.profileDetails, ['Asked about API integrations']);
    assert.equal(result.sessionProfile.contactInformation.name, 'Session One');
    assert.equal(result.sessionProfile.contactInformation.email, 'sess1@example.com');
    assert.equal(result.currentLead.exists, true);
    assert.equal(result.currentLead.leadId, 'sess1-lead.md');
    assert.equal(result.currentLead.profile, 'Developer');
    assert.equal(result.currentLead.sessionId, 'sess1');
    assert.equal(result.currentLead.contactInfo.email, 'sess1@example.com');
    assert.match(result.combinedSiteInfo, /WebAssist builds AI-assisted websites/);
    assert.match(result.combinedProfiles, /Profile: Developer/);
    assert.doesNotMatch(result.sessionProfileText, /Tell me about your API/);
    assert.match(result.sessionProfileText, /Session:/);
    assert.doesNotMatch(result.conversationHistoryText, /First user message/);
    assert.doesNotMatch(result.conversationHistoryText, /First agent response/);
    assert.match(result.conversationHistoryText, /\*\*User\*\*: Second user message/);
    assert.match(result.conversationHistoryText, /\*\*Agent\*\*: Sixth agent response/);

    const missingSessionResult = await loadContext({
        siteId: SITE_ID,
        sessionId: 'new-session',
    });
    assert.equal(missingSessionResult.sessionProfile.isNewSession, true);
    assert.deepEqual(missingSessionResult.sessionProfile.contactInformation, {});
    assert.equal(missingSessionResult.currentLead.exists, false);
    assert.match(
        missingSessionResult.sessionProfileText,
        /No previous session record found/
    );
    assert.equal(missingSessionResult.conversationHistoryText, 'No previous conversation history found.');
});
