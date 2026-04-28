import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebAssistSandbox } from './helpers.mjs';
import { updateSessionProfile } from '../src/runtime/update-session.mjs';
import { loadContext } from '../src/runtime/load-context.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';
import { action as createLeadAction } from '../skills/create-lead/src/index.mjs';

test('load-context.runtime loads info, profile definitions, and parsed session state', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    await updateSessionProfile({
        sessionId: 'sess1',
        profiles: ['Developer.md'],
        profileDetails: ['Asked about API integrations'],
        contactInformation: {
            name: 'Session One',
            email: 'sess1@example.com',
        },
    });
    await createLeadAction({
        promptText: JSON.stringify({
            sessionId: 'sess1',
            contactInfo: { email: 'sess1@example.com', name: 'Session One' },
            profile: 'Developer',
            summary: 'Qualified developer profile.',
        }),
    });

    const result = await loadContext({
        sessionId: 'sess1',
    });

    assert.equal(result.siteInfo.length, 2);
    assert.equal(result.profilesInfo.length, 2);
    assert.equal(result.sessionProfile.isNewSession, false);
    assert.deepEqual(result.sessionProfile.profiles, ['Developer.md']);
    assert.deepEqual(result.sessionProfile.profileDetails, ['Asked about API integrations']);
    assert.equal(result.sessionProfile.contactInformation.name, 'Session One');
    assert.equal(result.sessionProfile.contactInformation.email, 'sess1@example.com');
    assert.equal(result.currentLead.exists, true);
    assert.equal(result.currentLead.leadId, 'sess1-lead.md');
    assert.equal(result.currentLead.profile, 'Developer');
    assert.equal(result.currentLead.sessionId, 'sess1');
    assert.equal(result.currentLead.contactInfo.email, 'sess1@example.com');
    assert.match(result.combinedSiteInfo, /WebAssist builds AI-assisted websites/);
    assert.match(result.combinedProfilesInfo, /Profile: Developer/);
    assert.doesNotMatch(result.sessionProfileText, /Tell me about your API/);
    assert.match(result.sessionProfileText, /Session Profile/);

    const missingSessionResult = await loadContext({
        sessionId: 'new-session',
    });
    assert.equal(missingSessionResult.sessionProfile.isNewSession, true);
    assert.deepEqual(missingSessionResult.sessionProfile.contactInformation, {});
    assert.equal(missingSessionResult.currentLead.exists, false);
    assert.match(
        missingSessionResult.sessionProfileText,
        /No previous session profile found/
    );
});
