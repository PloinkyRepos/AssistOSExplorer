import {
    getDataStore,
} from './dataStore.mjs';
import {
    DATASTORE_TYPES,
    SESSION_SECTIONS,
    getSessionHistoryFileName,
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
    siteId,
    sessionId,
    profiles,
    profileDetails,
    contactInformation,
    consent,
}) {
    if (!siteId) {
        throw new Error('webassist-session requires siteId.');
    }
    if (!sessionId) {
        throw new Error('webassist-session requires sessionId.');
    }

    const store = getDataStore();
    const sessionFileName = getSessionHistoryFileName(sessionId);
    const nextProfiles = uniqueStrings(profiles);
    const nextProfileDetails = uniqueStrings(profileDetails);
    const nextConsent = String(consent ?? '').trim() || '*None*';
    let existingContactInformationSection = '*None*';
    let existingContactInformation = {};
    let existingHistory = '*None*';
    try {
        const existingProfile = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, sessionFileName);
        existingContactInformationSection = existingProfile.sections?.[SESSION_SECTIONS.CONTACT_INFORMATION] ?? '*None*';
        existingContactInformation = store.parseKeyValue(existingContactInformationSection);
        existingHistory = existingProfile.sections?.[SESSION_SECTIONS.HISTORY] ?? '*None*';
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

    await store.replaceFile(DATASTORE_TYPES.SESSIONS, sessionFileName, {
        [SESSION_SECTIONS.TARGET_PROFILES]: store.renderList(nextProfiles),
        [SESSION_SECTIONS.PROFILE_DETAILS]: store.renderList(nextProfileDetails),
        [SESSION_SECTIONS.CONTACT_INFORMATION]: nextContactInformationSection,
        [SESSION_SECTIONS.CONSENT]: nextConsent,
        [SESSION_SECTIONS.HISTORY]: existingHistory,
    });

    const savedProfile = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, sessionFileName);
    const parsedContactInformation = store.parseKeyValue(savedProfile.sections?.[SESSION_SECTIONS.CONTACT_INFORMATION]);

    return {
        success: true,
        siteId,
        sessionId,
        sessionPath: `${sessionFileName}.md`,
        sessionProfile: {
            profiles: nextProfiles,
            profileDetails: nextProfileDetails,
            contactInformation: parsedContactInformation,
            consent: nextConsent,
            profileRawContent: savedProfile.rawMarkdown,
        },
    };
}

export async function appendSessionTurn({
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

    const store = getDataStore();
    const historyFileName = getSessionHistoryFileName(sessionId);
    const historyAppend = store.renderDialogue([
        { speaker: 'User', message: userMessage },
        { speaker: 'Agent', message: agentResponse },
    ]);
    let existingHistory = '*None*';
    let existingSections = {
        [SESSION_SECTIONS.TARGET_PROFILES]: '*None*',
        [SESSION_SECTIONS.PROFILE_DETAILS]: '*None*',
        [SESSION_SECTIONS.CONTACT_INFORMATION]: '*None*',
        [SESSION_SECTIONS.CONSENT]: '*None*',
    };
    try {
        const existing = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, historyFileName);
        existingHistory = existing.sections[SESSION_SECTIONS.HISTORY] ?? '*None*';
        existingSections = {
            [SESSION_SECTIONS.TARGET_PROFILES]: existing.sections?.[SESSION_SECTIONS.TARGET_PROFILES] ?? '*None*',
            [SESSION_SECTIONS.PROFILE_DETAILS]: existing.sections?.[SESSION_SECTIONS.PROFILE_DETAILS] ?? '*None*',
            [SESSION_SECTIONS.CONTACT_INFORMATION]: existing.sections?.[SESSION_SECTIONS.CONTACT_INFORMATION] ?? '*None*',
            [SESSION_SECTIONS.CONSENT]: existing.sections?.[SESSION_SECTIONS.CONSENT] ?? '*None*',
        };
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    await store.replaceFile(DATASTORE_TYPES.SESSIONS, historyFileName, {
        ...existingSections,
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
        siteId,
        sessionId,
        sessionHistoryPath: `${historyFileName}.md`,
        sessionHistory: {
            history: parsedHistory,
            historyRawContent: savedHistory.rawMarkdown,
        },
    };
}
