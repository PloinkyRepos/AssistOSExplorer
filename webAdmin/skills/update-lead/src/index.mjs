import {
    getDataStore,
} from '../../../src/runtime/dataStore.mjs';
import { DATASTORE_TYPES, LEAD_FIELDS, LEAD_SECTIONS } from '../../../src/constants/datastore.mjs';

const ALLOWED_STATUSES = new Set(['invalid', 'contacted', 'converted']);

function normalizeLeadId(leadId) {
    const normalized = typeof leadId === 'string' ? leadId.trim() : '';
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
        throw new Error('update-lead expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('update-lead input must be an object.');
    }
    return parsed;
}

export async function action({ promptText }) {
    let payload;
    try {
        payload = parseInput(promptText);
    } catch (error) {
        const message = error?.message || 'Invalid input.';
        return message;
    }

    const { leadId, newStatus } = payload;

    if (typeof leadId !== 'string' || !leadId.trim()) {
        const message = 'leadId is required.';
        return message;
    }
    if (!ALLOWED_STATUSES.has(newStatus)) {
        const message = `Invalid status: ${newStatus}`;
        return message;
    }

    const store = getDataStore();
    const normalizedLeadId = normalizeLeadId(leadId);

    let existingLead;
    try {
        existingLead = await store.getSectionMap(DATASTORE_TYPES.LEADS, normalizedLeadId);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            const message = `Lead not found: ${normalizedLeadId}`;
            return message;
        }
        throw error;
    }

    const leadInfo = store.parseKeyValue(existingLead.sections[LEAD_SECTIONS.LEAD_INFO]);
    const updatedLead = {
        status: newStatus,
        profile: String(leadInfo[LEAD_FIELDS.PROFILE] ?? '').trim() || null,
        sessionId: String(leadInfo[LEAD_FIELDS.SESSION_ID] ?? '').trim() || null,
        createdAt: String(leadInfo[LEAD_FIELDS.CREATED_AT] ?? '').trim() || null,
        updatedAt: toIsoTimestamp(),
        contactInfo: store.parseKeyValue(existingLead.sections[LEAD_SECTIONS.CONTACT_INFO]),
        summary: String(existingLead.sections[LEAD_SECTIONS.SUMMARY] ?? '').trim(),
    };
    const content = await store.replaceFile(DATASTORE_TYPES.LEADS, normalizedLeadId, {
        [LEAD_SECTIONS.LEAD_INFO]: [
            `- **${LEAD_FIELDS.STATUS}**: ${updatedLead.status}`,
            `- **${LEAD_FIELDS.PROFILE}**: ${updatedLead.profile}`,
            `- **${LEAD_FIELDS.SESSION_ID}**: ${updatedLead.sessionId}`,
            `- **${LEAD_FIELDS.CREATED_AT}**: ${updatedLead.createdAt}`,
            `- **${LEAD_FIELDS.UPDATED_AT}**: ${updatedLead.updatedAt}`,
        ].join('\n'),
        [LEAD_SECTIONS.CONTACT_INFO]: store.renderKeyValue(updatedLead.contactInfo),
        [LEAD_SECTIONS.SUMMARY]: updatedLead.summary,
    });

    return [
        `Lead ${normalizedLeadId} updated to status ${updatedLead.status}.`,
        `Lead ID: ${normalizedLeadId}.md`,
        `Profile: ${updatedLead.profile || 'unknown'}`,
        `Session ID: ${updatedLead.sessionId || 'unknown'}`,
        `Created At: ${updatedLead.createdAt || 'unknown'}`,
        `Updated At: ${updatedLead.updatedAt || 'unknown'}`,
        '',
        'Lead Markdown:',
        content.rawMarkdown,
    ].join('\n');
}
