import {
    getDataStore,
} from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    LEAD_FIELDS,
    LEAD_SECTIONS,
    getSessionLeadFileName,
} from '../../../src/constants/datastore.mjs';

function normalizeLeadId(leadId) {
    const normalized = String(leadId ?? '').trim();
    if (!normalized) {
        throw new Error('leadId is required.');
    }
    return normalized.endsWith('.md') ? normalized.slice(0, -3) : normalized;
}

function toIsoTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Cannot convert invalid date to ISO timestamp.');
    }
    return date.toISOString();
}

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('createLead expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('createLead input must be an object.');
    }
    return parsed;
}

function normalizeContactInfo(contactInfo) {
    const entries = Object.entries(contactInfo ?? {})
        .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
        .filter(([key, value]) => key && value);

    if (entries.length === 0) {
        throw new Error('createLead requires at least one contact detail.');
    }

    return Object.fromEntries(entries);
}

export async function action({ promptText }) {
    const {
        sessionId,
        contactInfo,
        profile,
        summary,
    } = parseInput(promptText);

    if (!sessionId || !profile || !summary) {
        throw new Error('createLead requires sessionId, profile, and summary.');
    }

    const normalizedContactInfo = normalizeContactInfo(contactInfo);
    const store = getDataStore();
    const leadId = `${getSessionLeadFileName(sessionId)}.md`;
    const normalizedLeadId = normalizeLeadId(leadId);
    const timestamp = toIsoTimestamp();

    let existingLead = null;
    try {
        const existing = await store.getSectionMap(DATASTORE_TYPES.LEADS, normalizedLeadId);
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
        profile,
        sessionId,
        contactInfo: normalizedContactInfo,
        summary,
        createdAt: existingLead?.createdAt || timestamp,
        updatedAt: timestamp,
    };
    const saved = await store.replaceFile(DATASTORE_TYPES.LEADS, normalizedLeadId, {
        [LEAD_SECTIONS.LEAD_INFO]: [
            `- **${LEAD_FIELDS.STATUS}**: ${leadRecord.status}`,
            `- **${LEAD_FIELDS.PROFILE}**: ${leadRecord.profile}`,
            `- **${LEAD_FIELDS.SESSION_ID}**: ${leadRecord.sessionId}`,
            `- **${LEAD_FIELDS.CREATED_AT}**: ${leadRecord.createdAt}`,
            `- **${LEAD_FIELDS.UPDATED_AT}**: ${leadRecord.updatedAt}`,
        ].join('\n'),
        [LEAD_SECTIONS.CONTACT_INFO]: store.renderKeyValue(leadRecord.contactInfo),
        [LEAD_SECTIONS.SUMMARY]: String(leadRecord.summary ?? '').trim(),
    });

    const contactLines = Object.entries(leadRecord.contactInfo)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join('\n');

    return [
        `${existingLead ? 'Updated' : 'Created'} lead ${leadId}.`,
        `Lead path: ${normalizedLeadId}.md`,
        `Status: ${leadRecord.status}`,
        `Profile: ${leadRecord.profile}`,
        `Session ID: ${leadRecord.sessionId}`,
        `Created At: ${leadRecord.createdAt}`,
        `Updated At: ${leadRecord.updatedAt}`,
        'Contact Info:',
        contactLines,
        'Summary:',
        leadRecord.summary,
        'Lead Markdown:',
        saved.rawMarkdown,
    ].join('\n');
}
