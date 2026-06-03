import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LLMAgent } from 'achillesAgentLib';

import { createWebAssistAgent } from '../src/index.mjs';
import { getSessionHistoryFileName } from '../src/constants/datastore.mjs';
import { createWebAssistSandbox } from './helpers.mjs';

const SITE_ID = 'demo-site';

class FakeWebAssistLLM extends LLMAgent {
    constructor() {
        super({
            name: 'FakeWebAssistLLM',
            invokerStrategy: async () => '',
        });
        this.calls = [];
    }

    async complete({ prompt, context }) {
        this.calls.push({ type: 'complete', prompt, context });

        if (context?.intent !== 'agentic-session-planner') {
            throw new Error(`Unexpected complete intent: ${context?.intent}`);
        }

        const runtimePrompt = String(context?.userPrompt ?? '');
        const sessionId = runtimePrompt.match(/"sessionId"\s*:\s*"([^\"]+)"/)?.[1] || 'visitor-42';
        const siteId = runtimePrompt.match(/Site ID:\n([^\n]+)/)?.[1] || SITE_ID;

        if (!prompt.includes('TOOL[webassist-match]')) {
            return {
                tool: 'webassist-match',
                toolPrompt: JSON.stringify({
                    siteId,
                    sessionId,
                    profile: 'Developer',
                    mandatoryConditionsSatisfied: true,
                    matchExplanation: 'High-intent developer asking for an API integration discussion.',
                }),
                reason: 'Validate qualified match.',
            };
        }

        if (!prompt.includes('TOOL[webassist-lead]')) {
            return {
                tool: 'webassist-lead',
                toolPrompt: JSON.stringify({
                    siteId,
                    sessionId,
                    contactInfo: {
                        email: 'alice@example.com',
                        name: 'Alice Example',
                    },
                    profile: 'Developer',
                    mandatoryConditionsSatisfied: true,
                    matchExplanation: 'High-intent developer asking for an API integration discussion.',
                    consentGranted: true,
                    consentText: 'Alice explicitly agreed to follow-up storage.',
                    summary: 'High-intent developer asking for an API integration discussion.',
                    contactRoute: 'https://cal.example.com/webassist-demo',
                }),
                reason: 'Create qualified consented lead.',
            };
        }

        if (!prompt.includes('TOOL[webassist-session]')) {
            return {
                tool: 'webassist-session',
                toolPrompt: JSON.stringify({
                    siteId,
                    sessionId,
                    profiles: ['Developer.md'],
                    profileDetails: ['Evaluating an API integration', 'Provided email address'],
                    contactInformation: {
                        name: 'Alice Example',
                        email: 'alice@example.com',
                    },
                    consent: 'Alice explicitly agreed to follow-up storage.',
                }),
                reason: 'Persist profiling updates.',
            };
        }

        return {
            tool: 'final_answer',
            toolPrompt: 'Sigur — va putem ajuta cu integrarea API-ului. Mai jos gasiti linkul de programare.',
            reason: 'Return final runtime payload.',
        };
    }
}

test('webAssist agent loads AchillesAgentLib and executes a full visitor turn', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    const sandboxDataStoreModule = await import(pathToFileURL(path.join(sandbox.agentRoot, 'src', 'runtime', 'dataStore.mjs')).href);
    sandboxDataStoreModule.configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir, siteId: SITE_ID });

    const llmAgent = new FakeWebAssistLLM();
    const agent = await createWebAssistAgent({
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
        llmAgent,
    });

    const result = await agent.handleMessage({
        siteId: SITE_ID,
        sessionId: 'visitor-42',
        message: 'Buna, vreau sa integrez API-ul vostru. Sunt Alice, alice@example.com. Putem programa o discutie?',
    });

    assert.equal(agent.achilles.libraryName, 'achillesAgentLib');
    assert.match(result.response, /integrarea API-ului/);
    assert.equal(result.sessionId, 'visitor-42');
    assert.ok(llmAgent.calls.length >= 3);
    assert.match(String(llmAgent.calls[0]?.context?.userPrompt ?? ''), /Conversation History \(last 10 replies\):/);

    const leadContent = await fs.readFile(
        path.join(sandbox.dataDir, 'sites', SITE_ID, 'leads', 'visitor-42-lead.md'),
        'utf8'
    );
    assert.match(leadContent, /- \*\*Profile\*\*: Developer/);
    assert.match(leadContent, /alice@example\.com/);

    const sessionHistoryContent = await fs.readFile(
        path.join(sandbox.dataDir, 'sites', SITE_ID, 'sessions', `${getSessionHistoryFileName('visitor-42')}.md`),
        'utf8'
    );
    assert.match(sessionHistoryContent, /- Developer\.md/);
    assert.match(sessionHistoryContent, /Evaluating an API integration/);
    assert.match(sessionHistoryContent, /Provided email address/);
    assert.match(sessionHistoryContent, /### 3\. Contact Information/);
    assert.match(sessionHistoryContent, /- \*\*name\*\*: Alice Example/);
    assert.match(sessionHistoryContent, /- \*\*email\*\*: alice@example\.com/);
    assert.match(sessionHistoryContent, /Buna, vreau sa integrez API-ul vostru/);
    assert.match(sessionHistoryContent, /Mai jos gasiti linkul de programare/);
});
