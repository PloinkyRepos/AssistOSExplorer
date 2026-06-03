import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAssistSandbox } from './helpers.mjs';
import { action } from '../skills/webassist-lead/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

const SITE_ID = 'demo-site';

function leadPayload(overrides = {}) {
    return {
        siteId: SITE_ID,
        sessionId: 'session-xyz',
        contactInfo: { email: 'test@example.com', name: 'John Doe' },
        profile: 'Developer',
        mandatoryConditionsSatisfied: true,
        matchExplanation: 'The visitor is planning an API integration and provided direct contact details.',
        consentGranted: true,
        consentText: 'The visitor explicitly agreed to follow-up storage.',
        summary: 'Wants to integrate an API.',
        contactRoute: 'https://cal.example.com/webassist-demo',
        ...overrides,
    };
}

test('webassist-lead writes a deterministic site-scoped lead and requires explicit consent', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir, siteId: SITE_ID });

    await assert.rejects(
        () => action({
            promptText: JSON.stringify(leadPayload({ consentGranted: false, consentText: '' })),
        }),
        /explicit consent/
    );

    const firstResult = await action({
        promptText: JSON.stringify(leadPayload()),
    });

    assert.match(firstResult, /Created lead session-xyz-lead\.md\./);
    assert.match(firstResult, /Profile: Developer/);

    const secondResult = await action({
        promptText: JSON.stringify(leadPayload({ summary: 'Ready to scope an implementation call.' })),
    });

    assert.match(secondResult, /Updated lead session-xyz-lead\.md\./);

    const leadsDir = path.join(sandbox.dataDir, 'sites', SITE_ID, 'leads');
    const files = await fs.readdir(leadsDir);
    assert.deepEqual(files, ['session-xyz-lead.md']);

    const content = await fs.readFile(path.join(leadsDir, files[0]), 'utf8');
    assert.match(content, /- \*\*Consent Granted\*\*: yes/);
    assert.match(content, /- \*\*Profile\*\*: Developer/);
    assert.match(content, /- \*\*email\*\*: test@example\.com/);
    assert.match(content, /The visitor explicitly agreed to follow-up storage\./);
    assert.match(content, /Ready to scope an implementation call\./);
});
