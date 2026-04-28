import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createWebAdminSandbox } from './helpers.mjs';
import { createWebAdminAgent } from '../src/WebAdminAgent.mjs';

function createFakeWebAdminLLM(LLMAgent) {
    return new class FakeWebAdminLLM extends LLMAgent {
        constructor() {
            super({
                name: 'FakeWebAdminLLM',
                invokerStrategy: async () => '',
            });
            this.calls = [];
        }

        async complete({ prompt, context }) {
            this.calls.push({ prompt, context });

            const allowedIntents = new Set(['agentic-session-planner', 'task-run']);
            if (context?.intent && !allowedIntents.has(context.intent)) {
                throw new Error(`Unexpected complete intent: ${context?.intent}`);
            }

            const userPrompt = String(context?.userPrompt || '');
            const classifierSource = userPrompt || prompt || '';

            if (classifierSource.includes('converted') || classifierSource.includes('marcheaza')) {
                if (!prompt.includes('TOOL[update-lead]')) {
                    return {
                        tool: 'update-lead',
                        toolPrompt: JSON.stringify({
                            leadId: 'dev-session-lead.md',
                            newStatus: 'converted',
                        }),
                        reason: 'Update lead status.',
                    };
                }

                return {
                    tool: 'final_answer',
                    toolPrompt: 'Am actualizat leadul dev-session-lead.md la statusul converted.',
                    reason: 'Return admin response.',
                };
            }

            if (!prompt.includes('TOOL[statistics]')) {
                return {
                    tool: 'statistics',
                    toolPrompt: JSON.stringify({ interval: 'month' }),
                    reason: 'Compute monthly stats.',
                };
            }

            return {
                tool: 'final_answer',
                toolPrompt: 'Statisticile pe luna curenta sunt pregatite.',
                reason: 'Return admin response.',
            };
        }

        async startSOPLangAgentSession(skillsDescription, initialPrompt, options = {}) {
            const commandsRegistry = options?.commandsRegistry;
            let lastResult = '';

            const runCommand = async (command, args) => {
                let output;
                await commandsRegistry.executeCommand({ command, args }, {
                    success: async (data) => {
                        output = data;
                        return { status: 'success', data };
                    },
                    fail: async (error) => {
                        output = error;
                        return { status: 'fail', error };
                    },
                });
                return output;
            };

            if (String(initialPrompt || '').includes('converted')) {
                const args = {
                    leadId: 'dev-session-lead.md',
                    newStatus: 'converted',
                };
                await runCommand('update-lead', [JSON.stringify(args)]);
                lastResult = 'Am actualizat leadul dev-session-lead.md la statusul converted.';
            } else {
                const args = { interval: 'month' };
                await runCommand('statistics', [JSON.stringify(args)]);
                lastResult = 'Statisticile pe luna curenta sunt pregatite.';
            }

            return {
                getVariables: async () => ({}),
                getLastResult: () => lastResult,
            };
        }
    }();
}

test('webAdmin agent loads achillesAgentLib and executes owner requests', async (t) => {
    let LLMAgent;
    try {
        ({ LLMAgent } = await import('achillesAgentLib'));
    } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('achillesAgentLib')) {
            t.skip('achillesAgentLib is not installed in webAdmin/node_modules.');
            return;
        }
        throw error;
    }

    const sandbox = await createWebAdminSandbox();
    t.after(async () => sandbox.cleanup());
    const sandboxDataStoreModule = await import(pathToFileURL(path.join(sandbox.agentRoot, 'src', 'runtime', 'dataStore.mjs')).href);
    sandboxDataStoreModule.configureDataStore({ agentRoot: sandbox.agentRoot, dataDir: sandbox.dataDir });

    const llmAgent = createFakeWebAdminLLM(LLMAgent);
    const agent = await createWebAdminAgent({
        agentRoot: sandbox.agentRoot,
        dataDir: sandbox.dataDir,
        llmAgent,
    });

    const updateResult = await agent.handleMessage({
        message: 'Te rog marcheaza dev-session-lead.md ca converted.',
    });

    assert.equal(agent.achilles.libraryName, 'achillesAgentLib');
    assert.equal('success' in updateResult, false);
    assert.match(updateResult.response, /statusul converted/);

    const updatedLeadContent = await fs.readFile(
        path.join(sandbox.dataDir, 'leads', 'dev-session-lead.md'),
        'utf8'
    );
    assert.match(updatedLeadContent, /- \*\*Status\*\*: converted/);

    const statsResult = await agent.handleMessage({
        message: 'Da-mi statisticile pe luna aceasta.',
        referenceDate: new Date('2026-04-06T12:00:00.000Z'),
    });

    assert.equal('success' in statsResult, false);
    assert.match(statsResult.response, /Statisticile pe luna curenta/);
    assert.ok(llmAgent.calls.length >= 4);
    const promptWithPreload = llmAgent.calls.find((call) => String(call?.prompt || '').includes('Known profile templates:'));
    assert.ok(promptWithPreload);
    assert.match(promptWithPreload.prompt, /User message:/);
    assert.match(promptWithPreload.prompt, /Owner info snapshot:/);
    assert.match(promptWithPreload.prompt, /Website info snapshot:/);
    assert.match(promptWithPreload.prompt, /Allowed tools:/);
});
