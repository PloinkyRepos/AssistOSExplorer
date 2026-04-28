import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MainAgent } from 'achillesAgentLib';
import {
    configureDataStore,
    getConfiguredDataDir,
    getDataStore,
} from './runtime/dataStore.mjs';
import { ADMIN_FLOW_SYSTEM_PROMPT } from './prompts/admin-flow-system-prompt.mjs';
import { loadContext } from './runtime/load-context.mjs';
import { DATASTORE_TYPES } from './constants/datastore.mjs';

function getDefaultAgentRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function buildBaseAgentOptions({ agentRoot, logger, mainAgentOptions }) {
    const explicitSkillRoot = path.join(agentRoot, 'skills');
    const requestedSkillRoots = Array.isArray(mainAgentOptions?.additionalSkillRoots)
        ? mainAgentOptions.additionalSkillRoots
        : [];
    const additionalSkillRoots = [explicitSkillRoot, ...requestedSkillRoots]
        .filter((value, index, all) => value && all.indexOf(value) === index);

    const baseOptions = {
        logger,
        startDir: agentRoot,
        additionalSkillRoots,
        ...(mainAgentOptions ?? {}),
    };

    return baseOptions;
}

function buildRuntimePrompt({ message, availableLeadIds, loadedContext, referenceDate }) {
    return [
        'User message:',
        String(message),
        'Reference date:',
        referenceDate instanceof Date ? referenceDate.toISOString() : String(referenceDate),
        'Known lead IDs:',
        availableLeadIds.length > 0 ? availableLeadIds.join('\n') : 'No leads available yet.',
        'Known profile templates:',
        String(loadedContext?.combinedProfiles ?? 'No profiles available.'),
        'Owner info snapshot:',
        String(loadedContext?.combinedOwnerInfo ?? 'No owner info available.'),
        'Website info snapshot:',
        String(loadedContext?.combinedSiteInfo ?? 'No site info available.'),
    ].join('\n');
}

function normalizeRuntimeResult(executionResult) {
    const response = String(executionResult?.result ?? '').trim();
    if (!response) {
        throw new Error('webAdmin orchestrator must return a non-empty response.');
    }

    return {
        response,
    };
}

async function listLeadIds() {
    const store = getDataStore();
    const leadFiles = await store.listFiles(DATASTORE_TYPES.LEADS);
    return leadFiles.files.map((fileName) => `${fileName}.md`);
}

export async function createWebAdminAgent({
    agentRoot = getDefaultAgentRoot(),
    dataDir = null,
    llmAgent = null,
    logger = null,
    mainAgentOptions = {},
} = {}) {
    const resolvedAgentRoot = path.resolve(agentRoot);
    configureDataStore({
        agentRoot: resolvedAgentRoot,
        dataDir,
    });
    const resolvedDataDir = getConfiguredDataDir();

    const mainAgent = new MainAgent(buildBaseAgentOptions({
        agentRoot: resolvedAgentRoot,
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
        agentRoot: resolvedAgentRoot,
        dataDir: resolvedDataDir,
        mainAgent,
        async handleMessage({ sessionId = null, message, mode = 'fast', referenceDate = new Date() }) {
            if (!message) {
                throw new Error('webAdmin.handleMessage requires a message.');
            }

            const availableLeadIds = await listLeadIds();
            const loadedContext = await loadContext();
            const runtimePrompt = buildRuntimePrompt({
                message,
                availableLeadIds,
                loadedContext,
                referenceDate,
            });
            const execution = await mainAgent.executePrompt(runtimePrompt, {
                model: mode,
                systemPrompt: ADMIN_FLOW_SYSTEM_PROMPT,
            });

            return normalizeRuntimeResult(execution);
        },
    };
}
