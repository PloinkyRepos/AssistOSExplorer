import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWebAdminSandbox } from './helpers.mjs';
import { action } from '../skills/manage-profile/src/index.mjs';
import { configureDataStore } from '../src/runtime/dataStore.mjs';

test('manage-profile creates or updates profiles case-insensitively', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const result = await action({
        promptText: JSON.stringify({
            profileName: 'Developer',
            characteristics: ['API-focused', 'Engineering-led'],
            interests: ['Integrations', 'Automation'],
            qualifyingCriteria: ['Owns technical roadmap', 'Has implementation budget'],
        }),
    });

    assert.equal(typeof result, 'string');
    assert.match(result, /Created profile Developer\.md\./);
    assert.match(result, /Characteristics:/);
    assert.match(result, /- API-focused/);

    const profilePath = path.join(sandbox.dataDir, 'profilesInfo', 'Developer.md');
    const content = await fs.readFile(profilePath, 'utf8');
    assert.match(content, /### 1\. Characteristics/);
    assert.match(content, /- API-focused/);
    assert.match(content, /### 2\. Interests/);
    assert.match(content, /- Integrations/);
    assert.match(content, /### 3\. Qualifying criteria/);
    assert.match(content, /- Has implementation budget/);

    const updated = await action({
        promptText: JSON.stringify({
            profileName: 'developer',
            characteristics: ['Revised profile'],
            interests: ['Case-insensitive update'],
            qualifyingCriteria: ['Updated criteria'],
        }),
    });

    assert.equal(typeof updated, 'string');
    assert.match(updated, /Updated profile Developer\.md\./);

    const updatedContent = await fs.readFile(profilePath, 'utf8');
    assert.match(updatedContent, /- Revised profile/);
    assert.match(updatedContent, /- Case-insensitive update/);
    assert.match(updatedContent, /- Updated criteria/);
});

test('manage-profile lists profiles and displays one profile with optional sections', async (t) => {
    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const profilesDir = path.join(sandbox.dataDir, 'profilesInfo');
    await fs.mkdir(profilesDir, { recursive: true });
    await fs.writeFile(
        path.join(profilesDir, 'Developer.md'),
        '### 1. Characteristics\n- API-focused\n\n### 2. Interests\n- Integrations\n\n### 3. Qualifying criteria\n- Has budget\n',
        'utf8'
    );
    await fs.writeFile(
        path.join(profilesDir, 'EnterpriseClient.md'),
        '### 1. Characteristics\n- Enterprise\n\n### 2. Interests\n- Security\n\n### 3. Qualifying criteria\n- Needs procurement\n',
        'utf8'
    );

    const listed = await action({
        promptText: JSON.stringify({}),
    });
    assert.equal(typeof listed, 'string');
    assert.match(listed, /Retrieved 2 profiles:/);
    assert.match(listed, /- Developer/);
    assert.match(listed, /- EnterpriseClient/);

    const displayed = await action({
        promptText: JSON.stringify({ profileName: 'Developer' }),
    });
    assert.equal(typeof displayed, 'string');
    assert.match(displayed, /Profile Developer loaded\./);
    assert.match(displayed, /Sections displayed:/);
    assert.match(displayed, /- Characteristics/);
    assert.match(displayed, /## Characteristics/);
    assert.match(displayed, /- API-focused/);

    const filtered = await action({
        promptText: JSON.stringify({ profileName: 'Developer', sections: ['Interests'] }),
    });
    assert.equal(typeof filtered, 'string');
    assert.match(filtered, /Sections displayed:/);
    assert.match(filtered, /- Interests/);
    assert.match(filtered, /## Interests/);
});
