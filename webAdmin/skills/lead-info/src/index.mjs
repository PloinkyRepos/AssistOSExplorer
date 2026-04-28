import {
    getDataStore,
} from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    LEAD_FIELDS,
    LEAD_SECTIONS,
    SESSION_SECTIONS,
    getSessionHistoryFileName,
    getSessionProfileFileName,
} from '../../../src/constants/datastore.mjs';

function normalizeLeadId(leadId) {
    const normalized = typeof leadId === 'string' ? leadId.trim() : '';
    if (!normalized) {
        throw new Error('leadId is required.');
    }
    return normalized.endsWith('.md') ? normalized.slice(0, -3) : normalized;
}

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('lead-info expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('lead-info input must be an object.');
    }
    return parsed;
}

function renderKeyValueMap(map) {
    const entries = Object.entries(map || {}).filter(([, value]) => String(value ?? '').trim() !== '');
    if (entries.length === 0) {
        return ['- *None*'];
    }
    return entries.map(([key, value]) => `- ${key}: ${value}`);
}

export async function action({ promptText }) {
    let payload;
    try {
        payload = parseInput(promptText);
    } catch (error) {
        const message = error?.message || 'Invalid input.';
        return message;
    }

    const { leadId } = payload;

    if (typeof leadId !== 'string' || !leadId.trim()) {
        const message = 'leadId is required.';
        return message;
    }

    const store = getDataStore();
    const normalizedLeadId = normalizeLeadId(leadId);

    try {
        const leadRecord = await store.getSectionMap(DATASTORE_TYPES.LEADS, normalizedLeadId);
        const leadInfo = store.parseKeyValue(leadRecord.sections[LEAD_SECTIONS.LEAD_INFO]);
        const sessionId = String(leadInfo[LEAD_FIELDS.SESSION_ID] ?? '').trim()
            || (normalizeLeadId(normalizedLeadId).match(/^(.*)-lead(?:-[^.]+)?$/)?.[1] ?? null);

        if (!sessionId) {
            const message = `Could not determine the session for ${normalizedLeadId}.`;
            return message;
        }

        let sessionRecord;
        let sessionHistoryRecord;
        try {
            sessionRecord = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, getSessionProfileFileName(sessionId));
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                sessionRecord = null;
            } else {
                throw error;
            }
        }
        try {
            sessionHistoryRecord = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, getSessionHistoryFileName(sessionId));
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                sessionHistoryRecord = null;
            } else {
                throw error;
            }
        }

        const leadData = {
            status: leadInfo[LEAD_FIELDS.STATUS] ?? null,
            profile: leadInfo[LEAD_FIELDS.PROFILE] ?? null,
            sessionId: leadInfo[LEAD_FIELDS.SESSION_ID] ?? null,
            createdAt: leadInfo[LEAD_FIELDS.CREATED_AT] ?? null,
            updatedAt: leadInfo[LEAD_FIELDS.UPDATED_AT] ?? null,
            contactInfo: store.parseKeyValue(leadRecord.sections[LEAD_SECTIONS.CONTACT_INFO]),
            summary: String(leadRecord.sections[LEAD_SECTIONS.SUMMARY] ?? '').trim(),
            rawContent: leadRecord.rawMarkdown,
        };

        const historyRaw = sessionHistoryRecord?.sections?.[SESSION_SECTIONS.HISTORY] ?? '*None*';
        const parsedHistory = store.parseDialogue(historyRaw).map((entry) => ({
            role: entry.speaker.toLowerCase(),
            message: entry.message,
        }));
        const sessionMarkdown = [
            sessionRecord ? `--- [Session Profile: ${getSessionProfileFileName(sessionId)}.md] ---\n${sessionRecord.rawMarkdown}` : '',
            sessionHistoryRecord ? `--- [Session History: ${getSessionHistoryFileName(sessionId)}.md] ---\n${sessionHistoryRecord.rawMarkdown}` : '',
        ].filter(Boolean).join('\n\n');
        const hasSessionData = Boolean(sessionRecord || sessionHistoryRecord);
        const profiles = store.parseList(sessionRecord?.sections?.[SESSION_SECTIONS.PROFILE]);
        const profileDetails = store.parseList(sessionRecord?.sections?.[SESSION_SECTIONS.PROFILE_DETAILS]);

        const lines = [
            `Lead details loaded for ${normalizedLeadId}.`,
            `Lead ID: ${normalizedLeadId}.md`,
            `Session ID: ${sessionId}`,
            `Status: ${leadData.status || 'unknown'}`,
            `Profile: ${leadData.profile || 'unknown'}`,
            `Created At: ${leadData.createdAt || 'unknown'}`,
            `Updated At: ${leadData.updatedAt || 'unknown'}`,
            '',
            'Contact Information:',
            ...renderKeyValueMap(leadData.contactInfo),
            '',
            'Summary:',
            leadData.summary || '*None*',
            '',
            `Session data found: ${hasSessionData ? 'yes' : 'no'}`,
        ];

        if (hasSessionData) {
            lines.push('Session profiles:');
            lines.push(...(profiles.length > 0 ? profiles.map((item) => `- ${item}`) : ['- *None*']));
            lines.push('Session profile details:');
            lines.push(...(profileDetails.length > 0 ? profileDetails.map((item) => `- ${item}`) : ['- *None*']));
            lines.push('Session history:');
            lines.push(...(parsedHistory.length > 0
                ? parsedHistory.map((entry) => `- ${entry.role}: ${entry.message}`)
                : ['- *None*']));
            lines.push('Session markdown:');
            lines.push(sessionMarkdown || '*None*');
        }

        lines.push('Lead markdown:');
        lines.push(leadRecord.rawMarkdown);
        return lines.join('\n');

    } catch (error) {
        if (error && error.code === 'ENOENT') {
            const message = `Lead not found: ${normalizedLeadId}`;
            return message;
        }
        throw error;
    }
}
