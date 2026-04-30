import {
    getDataStore,
} from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    SESSION_SECTIONS,
    getSessionHistoryFileName,
    getSessionProfileFileName,
} from '../../../src/constants/datastore.mjs';

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('session-info expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('session-info input must be an object.');
    }
    return parsed;
}

function normalizeSessionId(value) {
    const sessionId = typeof value === 'string' ? value.trim() : '';
    if (!sessionId) {
        throw new Error('sessionId is required.');
    }
    return sessionId;
}

function normalizeHistoryOptions(payload) {
    const includeFullHistory = payload.includeFullHistory === true;
    const rawLimit = payload.historyLimit === undefined ? 10 : Number(payload.historyLimit);
    if (!Number.isInteger(rawLimit) || rawLimit <= 0) {
        throw new Error('historyLimit must be a positive integer.');
    }

    return {
        includeFullHistory,
        historyLimit: rawLimit,
    };
}

export async function action({ promptText }) {
    let payload;
    try {
        payload = parseInput(promptText);
    } catch (error) {
        return error?.message || 'Invalid input.';
    }

    let sessionId;
    let historyOptions;
    try {
        sessionId = normalizeSessionId(payload.sessionId);
        historyOptions = normalizeHistoryOptions(payload);
    } catch (error) {
        return error?.message || 'Invalid input.';
    }

    const store = getDataStore();
    const profileFileName = getSessionProfileFileName(sessionId);
    const historyFileName = getSessionHistoryFileName(sessionId);

    let profileRecord = null;
    let historyRecord = null;

    try {
        profileRecord = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, profileFileName);
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    try {
        historyRecord = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, historyFileName);
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    if (!profileRecord && !historyRecord) {
        return `Session not found: ${sessionId}`;
    }

    const profiles = store.parseList(profileRecord?.sections?.[SESSION_SECTIONS.PROFILE]);
    const profileDetails = store.parseList(profileRecord?.sections?.[SESSION_SECTIONS.PROFILE_DETAILS]);
    const parsedHistory = store.parseDialogue(historyRecord?.sections?.[SESSION_SECTIONS.HISTORY]);
    const selectedHistory = historyOptions.includeFullHistory
        ? parsedHistory
        : parsedHistory.slice(0, historyOptions.historyLimit);

    const lines = [
        `Session details loaded for ${sessionId}.`,
        `Session ID: ${sessionId}`,
        `Profile file found: ${profileRecord ? 'yes' : 'no'}`,
        `History file found: ${historyRecord ? 'yes' : 'no'}`,
        '',
        'Profiles:',
        ...(profiles.length > 0 ? profiles.map((item) => `- ${item}`) : ['- *None*']),
        '',
        'Profile details:',
        ...(profileDetails.length > 0 ? profileDetails.map((item) => `- ${item}`) : ['- *None*']),
        '',
        historyOptions.includeFullHistory
            ? `Session history (${selectedHistory.length} total messages):`
            : `Session history (first ${selectedHistory.length}/${historyOptions.historyLimit} messages):`,
        ...(selectedHistory.length > 0
            ? selectedHistory.map((entry) => {
                const speaker = String(entry?.speaker ?? '').trim() || 'Unknown';
                const message = String(entry?.message ?? '').trim() || '*None*';
                return `- ${speaker}: ${message}`;
            })
            : ['- *None*']),
    ];

    if (profileRecord) {
        lines.push('');
        lines.push('Session profile markdown:');
        lines.push(profileRecord.rawMarkdown || '*None*');
    }

    if (historyRecord) {
        lines.push('');
        lines.push('Session history markdown:');
        lines.push(historyRecord.rawMarkdown || '*None*');
    }

    return lines.join('\n');
}
