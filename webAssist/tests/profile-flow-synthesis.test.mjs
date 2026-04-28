import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LLMAgent } from 'achillesAgentLib';

import { createWebAssistAgent } from '../src/index.mjs';
import { getSessionHistoryFileName, getSessionProfileFileName } from '../src/constants/datastore.mjs';
import { createWebAssistSandbox } from './helpers.mjs';

class FakeFlowSynthesisLLM extends LLMAgent {
    constructor() {
        super({
            name: 'FakeFlowSynthesisLLM',
            invokerStrategy: async () => '',
        });
        this.firstTurnPersisted = false;
        this.secondTurnPersisted = false;
    }

    async complete({ prompt, context }) {
        if (context?.intent !== 'agentic-session-planner') {
            throw new Error(`Unexpected complete intent: ${context?.intent}`);
        }

        const userPrompt = String(context?.userPrompt ?? '');
        const sessionId = userPrompt.match(/"sessionId"\s*:\s*"([^\"]+)"/)?.[1] || 'session-flow';
        const isSecondTurn = userPrompt.includes('I can share some papers later');

        if (isSecondTurn) {
            if (!this.secondTurnPersisted) {
                this.secondTurnPersisted = true;
                return {
                    tool: 'update-session-profile',
                    toolPrompt: JSON.stringify({
                        sessionId,
                        profiles: ['Researcher.md'],
                        profileDetails: [
                            'Interested in research collaboration',
                            'Open to academic-industry partnerships',
                            'The user did not answer the question about available datasets and student resources.',
                            'The user is asked about project timeline and expected outcomes. His/her next reply should answer the question.',
                        ],
                        contactInformation: {
                            name: 'Research Visitor',
                            email: 'research.visitor@example.com',
                        },
                    }),
                    reason: 'Persist second-turn profile data.',
                };
            }

            return {
                tool: 'final_answer',
                toolPrompt: 'Thanks. I still need one detail: what project timeline and expected outcomes do you have?',
                reason: 'Return second turn payload.',
            };
        }

        if (!this.firstTurnPersisted) {
            this.firstTurnPersisted = true;
            return {
                tool: 'update-session-profile',
                toolPrompt: JSON.stringify({
                    sessionId,
                    profiles: ['Researcher.md'],
                    profileDetails: [
                        'Interested in research collaboration',
                        'The user is asked about available datasets and student resources. His/her next reply should answer the question.',
                    ],
                    contactInformation: {
                        name: 'Research Visitor',
                    },
                }),
                reason: 'Persist first-turn profile data.',
            };
        }

        return {
            tool: 'final_answer',
            toolPrompt: 'Great. What available datasets and student resources can you provide for collaboration?',
            reason: 'Return first turn payload.',
        };
    }
}

test('webAssist persists orchestrator-authored conversation memory inside profile details and keeps history on disk', async (t) => {
    const sandbox = await createWebAssistSandbox();
    t.after(async () => sandbox.cleanup());
    const sandboxDataStoreModule = await import(pathToFileURL(path.join(sandbox.agentRoot, 'src', 'runtime', 'dataStore.mjs')).href);
    sandboxDataStoreModule.configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const agent = await createWebAssistAgent({
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
        llmAgent: new FakeFlowSynthesisLLM(),
    });

    const firstTurn = await agent.handleMessage({
        sessionId: 'session-flow-1',
        message: 'Can we collaborate on AI research?',
    });

    assert.equal(firstTurn.response, 'Great. What available datasets and student resources can you provide for collaboration?');

    const secondTurn = await agent.handleMessage({
        sessionId: 'session-flow-1',
        message: 'I can share some papers later.',
    });

    assert.equal(secondTurn.response, 'Thanks. I still need one detail: what project timeline and expected outcomes do you have?');

    const profilePath = path.join(sandbox.dataDir, 'sessions', `${getSessionProfileFileName('session-flow-1')}.md`);
    const historyPath = path.join(sandbox.dataDir, 'sessions', `${getSessionHistoryFileName('session-flow-1')}.md`);
    const profileContent = await fs.readFile(profilePath, 'utf8');
    const historyContent = await fs.readFile(historyPath, 'utf8');

    assert.match(profileContent, /The user did not answer the question about available datasets and student resources\./);
    assert.match(profileContent, /The user is asked about project timeline and expected outcomes\./);
    assert.match(profileContent, /- \*\*name\*\*: Research Visitor/);
    assert.match(profileContent, /- \*\*email\*\*: research\.visitor@example\.com/);
    assert.match(historyContent, /Can we collaborate on AI research\?/);
    assert.match(historyContent, /I can share some papers later\./);
});
