import {
    getDataStore,
} from '../../../src/runtime/dataStore.mjs';
import { DATASTORE_TYPES, LEAD_FIELDS, LEAD_SECTIONS } from '../../../src/constants/datastore.mjs';

function toIsoTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Cannot convert invalid date to ISO timestamp.');
    }
    return date.toISOString();
}

function parseTimestamp(value) {
    if (!value) {
        return null;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
}

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('news expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('news input must be an object.');
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

    const { limit = 5 } = payload;

    const store = getDataStore();
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
    const listing = await store.listFiles(DATASTORE_TYPES.LEADS);
    const leadRecords = await Promise.all(
        listing.files.map(async (itemName) => {
            const lead = await store.getSectionMap(DATASTORE_TYPES.LEADS, itemName);
            const leadInfo = store.parseKeyValue(lead.sections[LEAD_SECTIONS.LEAD_INFO]);
            const stats = await store.getFileStats(DATASTORE_TYPES.LEADS, itemName);
            const createdAt = String(leadInfo[LEAD_FIELDS.CREATED_AT] ?? '').trim();
            const timestamp = parseTimestamp(createdAt)
                ?? (stats.stats.birthtimeMs && stats.stats.birthtimeMs > 0 ? stats.stats.birthtimeMs : stats.stats.mtimeMs);
            return {
                fileName: `${itemName}.md`,
                leadInfo,
                summary: String(lead.sections[LEAD_SECTIONS.SUMMARY] ?? '').trim(),
                timestamp,
            };
        })
    );

    if (leadRecords.length === 0) {
        return 'No leads found.';
    }

    leadRecords.sort((left, right) => right.timestamp - left.timestamp);
    const recentLeads = leadRecords.slice(0, normalizedLimit).map((leadRecord) => ({
        leadId: leadRecord.fileName,
        status: String(leadRecord.leadInfo[LEAD_FIELDS.STATUS] ?? '').trim() || 'unknown',
        profile: String(leadRecord.leadInfo[LEAD_FIELDS.PROFILE] ?? '').trim() || 'unknown',
        summary: leadRecord.summary || '',
        createdAt: String(leadRecord.leadInfo[LEAD_FIELDS.CREATED_AT] ?? '').trim() || toIsoTimestamp(new Date(leadRecord.timestamp)),
    }));

    return [
        `Retrieved ${recentLeads.length} recent lead${recentLeads.length === 1 ? '' : 's'}.`,
        ...recentLeads.map((lead) => [
            `- ${lead.leadId}`,
            `  status: ${lead.status}`,
            `  profile: ${lead.profile}`,
            `  createdAt: ${lead.createdAt}`,
            `  summary: ${lead.summary || '*None*'}`,
        ].join('\n')),
    ].join('\n');
}
