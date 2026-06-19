import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MainAgent } from 'achillesAgentLib';
import { VISITOR_FLOW_SYSTEM_PROMPT } from './prompts/visitor-flow-system-prompt.mjs';
import { loadAkuContext } from './runtime/load-aku-context.mjs';
import { appendSessionTurn } from './runtime/update-session.mjs';
import { resolveSiteDataDir } from './runtime/akuStore.mjs';

function getCodeRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function buildBaseAgentOptions({ codeRoot, logger, mainAgentOptions }) {
    const explicitSkillRoot = path.join(codeRoot, 'skills');
    const requestedSkillRoots = Array.isArray(mainAgentOptions?.additionalSkillRoots)
        ? mainAgentOptions.additionalSkillRoots
        : [];
    const additionalSkillRoots = [explicitSkillRoot, ...requestedSkillRoots]
        .filter((value, index, all) => value && all.indexOf(value) === index);

    return {
        logger,
        startDir: codeRoot,
        additionalSkillRoots,
        ...(mainAgentOptions ?? {}),
    };
}

function buildRuntimePrompt({ siteId, sessionId, message, loadedContext }) {
    return [
        'User message:',
        String(message),
        'Site ID:',
        String(siteId),
        'Session ID:',
        String(sessionId),
        'Session profile:',
        JSON.stringify(loadedContext.sessionProfile ?? {}, null, 2),
        'Current lead:',
        JSON.stringify(loadedContext.currentLead ?? {}, null, 2),
        'Session profile markdown snapshot:',
        String(loadedContext.sessionProfile?.sessionProfileText ?? ''),
        'Relevant Site Context (from AKU):',
        String(loadedContext.akuContextText ?? 'No relevant site context found.'),
        'Conversation History (last 10 replies):',
        String(loadedContext.conversationHistoryText ?? 'No previous conversation history found.'),
    ].join('\n');
}

export async function createWebAssistAgent({
    llmAgent = null,
    logger = null,
    mainAgentOptions = {},
} = {}) {
    const codeRoot = getCodeRoot();

    const mainAgent = new MainAgent(buildBaseAgentOptions({
        codeRoot,
        logger,
        mainAgentOptions,
    }));
    if (llmAgent) {
        mainAgent.llmAgent = llmAgent;
    }

    return {
        achilles: {
            libraryName: 'achillesAgentLib',
            source: 'node_modules',
        },
        mainAgent,
        async handleMessage({ siteId, sessionId, message, mode = 'soul_gateway/web-assist' }) {
            if (!siteId) {
                throw new Error('webAssist.handleMessage requires a siteId.');
            }
            if (!sessionId) {
                throw new Error('webAssist.handleMessage requires a sessionId.');
            }
            if (!message) {
                throw new Error('webAssist.handleMessage requires a message.');
            }

            const siteDataDir = resolveSiteDataDir(siteId);
            const loadedContext = await loadAkuContext({
                siteId,
                sessionId,
                message,
            });
            const runtimePrompt = buildRuntimePrompt({
                siteId,
                sessionId,
                message,
                loadedContext,
            });

            const execution = await mainAgent.executePrompt(runtimePrompt, {
                model: mode,
                systemPrompt: VISITOR_FLOW_SYSTEM_PROMPT,
                reasoningEffort: "low",
                context: {
                    siteDataDir,
                },
            });

            const response = String(execution.result ?? '').trim();
            if (!response) {
                throw new Error('webAssist orchestrator result must include a non-empty response.');
            }

            await appendSessionTurn({
                siteId,
                sessionId,
                userMessage: message,
                agentResponse: response,
            });

            return {
                response,
                siteId,
                sessionId,
            };
        },
    };
}
