import {
    getDataStore,
} from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    LEAD_FIELDS,
    LEAD_SECTIONS,
    SESSION_FILE_SUFFIX,
    SESSION_SECTIONS,
} from '../../../src/constants/datastore.mjs';

const DEFAULT_LEAD_LIMIT = 5;
const DEFAULT_SESSION_LIMIT = 5;
const DEFAULT_HISTORY_REPLY_LIMIT = 10;

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
    if (Object.prototype.hasOwnProperty.call(parsed, 'limit')) {
        throw new Error('news no longer accepts top-level limit. Use leads/sessions objects.');
    }
    return parsed;
}

function parseCollectionScope(payload, key, defaultLimit) {
    const scope = payload[key];
    if (scope === undefined) {
        return { enabled: true, all: false, limit: defaultLimit };
    }
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
        throw new Error(`${key} must be an object with { "limit": number } or { "all": true }.`);
    }
    if (scope.enabled === false) {
        return { enabled: false, all: false, limit: 0 };
    }
    if (scope.all === true) {
        return { enabled: true, all: true, limit: 0 };
    }
    const rawLimit = scope.limit;
    const normalizedLimit = rawLimit === undefined ? defaultLimit : Number(rawLimit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
        throw new Error(`${key}.limit must be a positive integer.`);
    }
    return { enabled: true, all: false, limit: normalizedLimit };
}

function deriveSessionId(fileName, suffix) {
    const ending = `-${suffix}`;
    return fileName.endsWith(ending)
        ? fileName.slice(0, -ending.length)
        : fileName;
}

async function collectRecentLeads(store, scope) {
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
                status: String(leadInfo[LEAD_FIELDS.STATUS] ?? '').trim() || 'unknown',
                profile: String(leadInfo[LEAD_FIELDS.PROFILE] ?? '').trim() || 'unknown',
                summary: String(lead.sections[LEAD_SECTIONS.SUMMARY] ?? '').trim(),
                createdAt: createdAt || toIsoTimestamp(new Date(timestamp)),
                timestamp,
            };
        })
    );

    leadRecords.sort((left, right) => right.timestamp - left.timestamp);
    return scope.all ? leadRecords : leadRecords.slice(0, scope.limit);
}

async function collectRecentSessions(store, scope) {
    const listing = await store.listFiles(DATASTORE_TYPES.SESSIONS);
    const profileFiles = listing.files.filter((fileName) => fileName.endsWith(`-${SESSION_FILE_SUFFIX.PROFILE}`));

    const sessionRecords = await Promise.all(
        profileFiles.map(async (fileName) => {
            const sessionId = deriveSessionId(fileName, SESSION_FILE_SUFFIX.PROFILE);
            const record = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, fileName);
            const stats = await store.getFileStats(DATASTORE_TYPES.SESSIONS, fileName);
            const profileDetails = store.parseList(record.sections?.[SESSION_SECTIONS.PROFILE_DETAILS]);
            return {
                sessionId,
                profileFileName: `${fileName}.md`,
                profileDetails,
                timestamp: stats.stats.mtimeMs,
            };
        })
    );

    sessionRecords.sort((left, right) => right.timestamp - left.timestamp);
    return scope.all ? sessionRecords : sessionRecords.slice(0, scope.limit);
}

async function collectSessionHistory(store, sessionId, replyLimit) {
    const historyFileName = `${sessionId}-${SESSION_FILE_SUFFIX.HISTORY}`;
    let record;
    try {
        record = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, historyFileName);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const dialogue = store.parseDialogue(record.sections?.[SESSION_SECTIONS.HISTORY]);
    const validEntries = dialogue.filter((entry) => {
        const speaker = String(entry?.speaker ?? '').trim();
        const message = String(entry?.message ?? '').trim();
        return speaker && message;
    });

    return validEntries.slice(-replyLimit);
}

function renderLeadsSection(leads, scope) {
    const label = scope.all
        ? `Recent leads (all ${leads.length}):`
        : `Recent leads (showing ${leads.length}, requested limit ${scope.limit}):`;

    if (leads.length === 0) {
        return [label, '- *No leads available.*'];
    }

    return [
        label,
        ...leads.map((lead) => [
            `- ${lead.fileName}`,
            `  status: ${lead.status}`,
            `  profile: ${lead.profile}`,
            `  createdAt: ${lead.createdAt}`,
            `  summary: ${lead.summary || '*None*'}`,
        ].join('\n')),
    ];
}

export async function action({ promptText }) {
    let payload;
    try {
        payload = parseInput(promptText);
    } catch (error) {
        return error?.message || 'Invalid input.';
    }

    let leadsScope;
    let sessionsScope;
    try {
        leadsScope = parseCollectionScope(payload, 'leads', DEFAULT_LEAD_LIMIT);
        sessionsScope = parseCollectionScope(payload, 'sessions', DEFAULT_SESSION_LIMIT);
    } catch (error) {
        return error?.message || 'Invalid input.';
    }

    if (!leadsScope.enabled && !sessionsScope.enabled) {
        return 'news requires at least one scope: leads or sessions.';
    }

    const store = getDataStore();
    const sections = ['News report ready.'];

    if (leadsScope.enabled) {
        const recentLeads = await collectRecentLeads(store, leadsScope);
        sections.push(renderLeadsSection(recentLeads, leadsScope).join('\n'));
    }

    if (sessionsScope.enabled) {
        const recentSessions = await collectRecentSessions(store, sessionsScope);
        const sessionLines = [`Recent sessions (showing ${recentSessions.length}):`];

        for (const session of recentSessions) {
            sessionLines.push(`Session: ${session.sessionId}`);
            sessionLines.push('Profile Details:');
            if (session.profileDetails.length > 0) {
                for (const detail of session.profileDetails) {
                    const normalized = String(detail ?? '').trim();
                    if (normalized) {
                        sessionLines.push(`- ${normalized}`);
                    }
                }
            } else {
                sessionLines.push('- *None*');
            }

            sessionLines.push('Session History:');
            const historyEntries = await collectSessionHistory(store, session.sessionId, DEFAULT_HISTORY_REPLY_LIMIT);
            if (historyEntries.length > 0) {
                for (const entry of historyEntries) {
                    const speaker = String(entry.speaker ?? '').trim();
                    const message = String(entry.message ?? '').trim();
                    sessionLines.push(`- ${speaker}: ${message}`);
                }
            } else {
                sessionLines.push('- *No history available.*');
            }

            sessionLines.push('');
        }

        if (sessionLines[sessionLines.length - 1] === '') {
            sessionLines.pop();
        }

        sections.push(sessionLines.join('\n'));
    }

    return sections.join('\n\n');
}
