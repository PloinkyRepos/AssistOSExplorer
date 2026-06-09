import { getDataStore } from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    LEAD_FIELDS,
    LEAD_SECTIONS,
    getSessionLeadFileName,
} from '../../../src/constants/datastore.mjs';

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('webassist-lead expects promptText to be valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('webassist-lead input must be an object.');
    }
    return parsed;
}

function normalizeContactInfo(contactInfo) {
    const entries = Object.entries(contactInfo ?? {})
        .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
        .filter(([key, value]) => key && value);

    if (entries.length === 0) {
        throw new Error('webassist-lead requires at least one explicit contact detail.');
    }

    return Object.fromEntries(entries);
}

function toIsoTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Cannot convert invalid date to ISO timestamp.');
    }
    return date.toISOString();
}

export async function action({ promptText }) {
    const {
        siteId,
        sessionId,
        profile,
        contactInfo,
    } = parseInput(promptText);

    if (!siteId || !sessionId || !profile) {
        throw new Error('webassist-lead requires siteId, sessionId, and profile.');
    }

    const normalizedContactInfo = normalizeContactInfo(contactInfo);
    const store = getDataStore();
    const leadFileName = getSessionLeadFileName(sessionId);
    const timestamp = toIsoTimestamp();

    let existingLead = null;
    try {
        const existing = await store.getSectionMap(DATASTORE_TYPES.LEADS, leadFileName);
        const leadInfo = store.parseKeyValue(existing.sections[LEAD_SECTIONS.LEAD_INFO]);
        existingLead = {
            createdAt: String(leadInfo[LEAD_FIELDS.CREATED_AT] ?? '').trim(),
            status: String(leadInfo[LEAD_FIELDS.STATUS] ?? '').trim(),
        };
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    const leadRecord = {
        status: existingLead?.status || 'new',
        profile: String(profile).trim(),
        sessionId: String(sessionId).trim(),
        contactInfo: normalizedContactInfo,
        createdAt: existingLead?.createdAt || timestamp,
        updatedAt: timestamp,
    };

    const saved = await store.replaceFile(DATASTORE_TYPES.LEADS, leadFileName, {
        [LEAD_SECTIONS.LEAD_INFO]: [
            `- **${LEAD_FIELDS.STATUS}**: ${leadRecord.status}`,
            `- **${LEAD_FIELDS.PROFILE}**: ${leadRecord.profile}`,
            `- **${LEAD_FIELDS.SESSION_ID}**: ${leadRecord.sessionId}`,
            `- **${LEAD_FIELDS.CREATED_AT}**: ${leadRecord.createdAt}`,
            `- **${LEAD_FIELDS.UPDATED_AT}**: ${leadRecord.updatedAt}`,
        ].join('\n'),
        [LEAD_SECTIONS.CONTACT_INFO]: store.renderKeyValue(leadRecord.contactInfo),
    });

    const contactFields = Object.keys(normalizedContactInfo).join(', ');
    return `Lead created for profile: ${profile}. Contact: ${contactFields}.`;
}
