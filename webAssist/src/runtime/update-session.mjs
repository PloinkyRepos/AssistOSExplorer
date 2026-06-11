import { AgenticKnowledgeUnits } from 'achillesAgentLib';
import { resolveSiteAkuDir } from './akuStore.mjs';

function uniqueStrings(values) {
    const seen = new Set();
    const result = [];

    for (const value of values ?? []) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

function renderContactInformation(contactInformation) {
    if (contactInformation == null) {
        return '';
    }
    if (typeof contactInformation === 'string') {
        return contactInformation.trim();
    }
    if (Array.isArray(contactInformation)) {
        return contactInformation.map((value) => `- ${String(value ?? '').trim()}`).join('\n');
    }
    if (typeof contactInformation === 'object') {
        const entries = Object.entries(contactInformation);
        if (entries.length === 0) {
            return '';
        }
        return entries
            .map(([key, value]) => `- **${String(key).trim()}**: ${String(value ?? '').trim()}`)
            .join('\n');
    }
    return String(contactInformation).trim();
}

function getSessionKuId(sessionId) {
    return `ku_sess_${sessionId}`;
}

async function getAkuInstance(agentRoot, dataDir, siteId) {
    const akuRootDir = resolveSiteAkuDir(agentRoot, siteId, dataDir);
    const aku = new AgenticKnowledgeUnits({
        rootDir: akuRootDir,
        actor: `webassist/${siteId}`,
    });

    const akuExists = await aku.exists();
    if (!akuExists) {
        throw new Error(`AKU not initialized for site: ${siteId}`);
    }

    await aku.loadAKU();
    return aku;
}

export async function updateSessionProfile({
    agentRoot,
    dataDir,
    siteId,
    sessionId,
    profileDetails,
    contactInformation,
}) {
    if (!siteId) {
        throw new Error('webassist-session requires siteId.');
    }
    if (!sessionId) {
        throw new Error('webassist-session requires sessionId.');
    }

    const aku = await getAkuInstance(agentRoot, dataDir, siteId);
    const sessionKuId = getSessionKuId(sessionId);
    const nextProfileDetails = uniqueStrings(profileDetails);

    let existingContactInformation = {};
    let existingState = '';

    try {
        const existingKU = await aku.loadKU(sessionKuId);
        existingState = existingKU.state || '';
        const metadata = existingKU.manifest?.metadata || {};
        existingContactInformation = metadata.contactInformation || {};
    } catch (error) {
        if (!error?.message?.includes('not found')) {
            throw error;
        }
    }

    let nextContactInformation = existingContactInformation;
    if (contactInformation !== undefined) {
        if (contactInformation && typeof contactInformation === 'object' && !Array.isArray(contactInformation)) {
            nextContactInformation = {
                ...existingContactInformation,
                ...contactInformation,
            };
        } else {
            nextContactInformation = {};
        }
    }

    const stateLines = [];
    if (nextProfileDetails.length > 0) {
        stateLines.push('## Profile Details');
        stateLines.push(nextProfileDetails.map(d => `- ${d}`).join('\n'));
    }
    if (Object.keys(nextContactInformation).length > 0) {
        stateLines.push('');
        stateLines.push('## Contact Information');
        stateLines.push(renderContactInformation(nextContactInformation));
    }
    const newState = stateLines.join('\n');

    try {
        await aku.loadKU(sessionKuId);
        await aku.updateKUState(sessionKuId, {
            state: newState,
            summary: `Session profile for ${sessionId}`,
            tags: ['session', 'profile'],
        });
    } catch (error) {
        if (error?.message?.includes('not found')) {
            await aku.initKU({
                ku_id: sessionKuId,
                ku_name: `Session ${sessionId}`,
                ku_type: 'session-profile',
                keywords: ['session', sessionId],
                tags: ['session', 'profile'],
                summary: `Session profile for ${sessionId}`,
                state: newState,
                metadata: {
                    sessionId,
                    profileDetails: nextProfileDetails,
                    contactInformation: nextContactInformation,
                },
            });
        } else {
            throw error;
        }
    }

    return {
        success: true,
        siteId,
        sessionId,
        sessionProfileKuId: sessionKuId,
        sessionProfile: {
            profileDetails: nextProfileDetails,
            contactInformation: nextContactInformation,
            profileRawContent: newState,
        },
    };
}

export async function appendSessionTurn({
    agentRoot,
    dataDir,
    siteId,
    sessionId,
    userMessage,
    agentResponse,
}) {
    if (!siteId) {
        throw new Error('webassist-session history requires siteId.');
    }
    if (!sessionId || !userMessage || !agentResponse) {
        throw new Error('webassist-session history requires sessionId, userMessage, and agentResponse.');
    }

    const aku = await getAkuInstance(agentRoot, dataDir, siteId);
    const sessionKuId = getSessionKuId(sessionId);

    const timestamp = new Date().toISOString();

    await aku.recordEvent(sessionKuId, {
        event_type: 'turn',
        title: 'User message',
        summary: userMessage.slice(0, 200),
        tags: ['turn', 'user'],
        metadata: {
            speaker: 'user',
            message: userMessage,
            timestamp,
        },
    });

    await aku.recordEvent(sessionKuId, {
        event_type: 'turn',
        title: 'Agent response',
        summary: agentResponse.slice(0, 200),
        tags: ['turn', 'agent'],
        metadata: {
            speaker: 'agent',
            message: agentResponse,
            timestamp,
        },
    });

    return {
        success: true,
        siteId,
        sessionId,
        sessionKuId,
    };
}

export { getSessionKuId };
