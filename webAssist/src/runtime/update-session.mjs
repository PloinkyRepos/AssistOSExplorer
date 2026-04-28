import {
    getDataStore,
} from './dataStore.mjs';
import {
    DATASTORE_TYPES,
    SESSION_SECTIONS,
    getSessionHistoryFileName,
    getSessionProfileFileName,
} from '../constants/datastore.mjs';

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
        return '*None*';
    }
    if (typeof contactInformation === 'string') {
        const normalized = contactInformation.trim();
        return normalized || '*None*';
    }
    if (Array.isArray(contactInformation)) {
        const lines = contactInformation.map((value) => `- ${String(value ?? '').trim()}`);
        return lines.join('\n') || '*None*';
    }
    if (typeof contactInformation === 'object') {
        const entries = Object.entries(contactInformation);
        if (entries.length === 0) {
            return '*None*';
        }
        return entries
            .map(([key, value]) => `- **${String(key).trim()}**: ${String(value ?? '').trim()}`)
            .join('\n');
    }
    const normalized = String(contactInformation).trim();
    return normalized || '*None*';
}

export async function updateSessionProfile({
    sessionId,
    profiles,
    profileDetails,
    contactInformation,
}) {
    if (!sessionId) {
        throw new Error('update-session profile requires sessionId.');
    }

    const store = getDataStore();
    const profileFileName = getSessionProfileFileName(sessionId);
    const nextProfiles = uniqueStrings(profiles);
    const nextProfileDetails = uniqueStrings(profileDetails);
    let existingContactInformationSection = '*None*';
    let existingContactInformation = {};
    try {
        const existingProfile = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, profileFileName);
        existingContactInformationSection = existingProfile.sections?.[SESSION_SECTIONS.CONTACT_INFORMATION] ?? '*None*';
        existingContactInformation = store.parseKeyValue(existingContactInformationSection);
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    let nextContactInformationSection = existingContactInformationSection;
    if (contactInformation !== undefined) {
        if (contactInformation && typeof contactInformation === 'object' && !Array.isArray(contactInformation)) {
            nextContactInformationSection = renderContactInformation({
                ...existingContactInformation,
                ...contactInformation,
            });
        } else {
            nextContactInformationSection = renderContactInformation(contactInformation);
        }
    }

    await store.replaceFile(DATASTORE_TYPES.SESSIONS, profileFileName, {
        [SESSION_SECTIONS.PROFILE]: store.renderList(nextProfiles),
        [SESSION_SECTIONS.PROFILE_DETAILS]: store.renderList(nextProfileDetails),
        [SESSION_SECTIONS.CONTACT_INFORMATION]: nextContactInformationSection,
    });

    const savedProfile = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, profileFileName);
    const parsedContactInformation = store.parseKeyValue(savedProfile.sections?.[SESSION_SECTIONS.CONTACT_INFORMATION]);

    return {
        success: true,
        sessionId,
        sessionProfilePath: `${profileFileName}.md`,
        sessionProfile: {
            profiles: nextProfiles,
            profileDetails: nextProfileDetails,
            contactInformation: parsedContactInformation,
            profileRawContent: savedProfile.rawMarkdown,
        },
    };
}

export async function appendSessionTurn({
    sessionId,
    userMessage,
    agentResponse,
}) {
    if (!sessionId || !userMessage || !agentResponse) {
        throw new Error('update-session history requires sessionId, userMessage, and agentResponse.');
    }

    const store = getDataStore();
    const historyFileName = getSessionHistoryFileName(sessionId);
    const historyAppend = store.renderDialogue([
        { speaker: 'User', message: userMessage },
        { speaker: 'Agent', message: agentResponse },
    ]);
    let existingHistory = '*None*';
    try {
        const existing = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, historyFileName);
        existingHistory = existing.sections[SESSION_SECTIONS.HISTORY] ?? '*None*';
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    await store.replaceFile(DATASTORE_TYPES.SESSIONS, historyFileName, {
        [SESSION_SECTIONS.HISTORY]: existingHistory,
    });
    await store.appendToFile(DATASTORE_TYPES.SESSIONS, historyFileName, {
        sections: {
            [SESSION_SECTIONS.HISTORY]: historyAppend,
        },
    });

    const savedHistory = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, historyFileName);
    const parsedHistory = store.parseDialogue(savedHistory.sections[SESSION_SECTIONS.HISTORY]).map((entry) => ({
        role: entry.speaker.toLowerCase(),
        message: entry.message,
    }));

    return {
        success: true,
        sessionId,
        sessionHistoryPath: `${historyFileName}.md`,
        sessionHistory: {
            history: parsedHistory,
            historyRawContent: savedHistory.rawMarkdown,
        },
    };
}
