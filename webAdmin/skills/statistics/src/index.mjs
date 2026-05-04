import fs from 'node:fs/promises';
import path from 'node:path';

import {
    getDataStore,
    getConfiguredDataDir,
} from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    LEAD_FIELDS,
    LEAD_SECTIONS,
    SESSION_FILE_SUFFIX,
} from '../../../src/constants/datastore.mjs';

const VISITORS_LOG_FILE = 'visitors.log';

function parseTimestamp(value) {
    if (!value) {
        return null;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
}

function getIntervalStart(interval, referenceDate = new Date()) {
    const endDate = referenceDate instanceof Date
        ? new Date(referenceDate.getTime())
        : new Date(referenceDate);

    if (Number.isNaN(endDate.getTime())) {
        throw new Error('referenceDate must be a valid date.');
    }

    const startDate = new Date(endDate.getTime());
    switch (interval) {
    case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
    case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
    case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    default:
        throw new Error(`Unsupported interval: ${interval}`);
    }
    return { start: startDate, end: endDate };
}

function isTimestampWithinWindow(timestamp, window) {
    if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) {
        return false;
    }
    return timestamp >= window.start.getTime() && timestamp <= window.end.getTime();
}

function parseVisitorEvent(rawLine) {
    if (!rawLine) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(rawLine);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }
    const visitorId = String(parsed.visitorId ?? '').trim();
    if (!visitorId) {
        return null;
    }
    const timestamp = parseTimestamp(String(parsed.timestamp ?? '').trim());
    if (timestamp === null) {
        return null;
    }

    return {
        visitorId,
        timestamp,
    };
}

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('statistics expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('statistics input must be an object.');
    }
    return parsed;
}

export async function action({ promptText, referenceDate = new Date() }) {
    const store = getDataStore();
    let payload;
    try {
        payload = parseInput(promptText);
    } catch (error) {
        const message = error?.message || 'Invalid input.';
        return message;
    }

    const { interval } = payload;

    let window;
    try {
        window = getIntervalStart(interval, referenceDate);
    } catch (error) {
        const message = error?.message || 'Invalid interval.';
        return message;
    }

    const dayWindow = getIntervalStart('day', referenceDate);
    const weekWindow = getIntervalStart('week', referenceDate);

    const sessionListing = await store.listFiles(DATASTORE_TYPES.SESSIONS);
    const sessionProfileFiles = sessionListing.files
        .filter((fileName) => fileName.endsWith(`-${SESSION_FILE_SUFFIX.PROFILE}`));

    const sessionStats = await Promise.all(
        sessionProfileFiles.map((itemName) => store.getFileStats(DATASTORE_TYPES.SESSIONS, itemName))
    );
    const totalSessions = sessionStats.filter((entry) => isTimestampWithinWindow(entry.stats.mtimeMs, window)).length;

    let totalLeads = 0;
    const leadsByProfile = {};

    const leadListing = await store.listFiles(DATASTORE_TYPES.LEADS);
    for (const itemName of leadListing.files) {
        const lead = await store.getSectionMap(DATASTORE_TYPES.LEADS, itemName);
        const leadInfo = store.parseKeyValue(lead.sections[LEAD_SECTIONS.LEAD_INFO]);
        const stats = await store.getFileStats(DATASTORE_TYPES.LEADS, itemName);
        const createdAt = parseTimestamp(String(leadInfo[LEAD_FIELDS.CREATED_AT] ?? '').trim());
        const timestamp = createdAt !== null
            ? createdAt
            : ((stats.stats.birthtimeMs && stats.stats.birthtimeMs > 0) ? stats.stats.birthtimeMs : stats.stats.mtimeMs);
        if (!isTimestampWithinWindow(timestamp, window)) {
            continue;
        }

        totalLeads += 1;
        const profile = String(leadInfo[LEAD_FIELDS.PROFILE] ?? '').trim();
        if (profile) {
            leadsByProfile[profile] = (leadsByProfile[profile] || 0) + 1;
        }
    }

    const allVisitors = new Set();
    const intervalVisitors = new Set();
    const visitorsToday = new Set();
    const visitorsThisWeek = new Set();

    const visitorsLogPath = path.join(getConfiguredDataDir(), VISITORS_LOG_FILE);
    try {
        const content = await fs.readFile(visitorsLogPath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const event = parseVisitorEvent(line.trim());
            if (!event) {
                continue;
            }

            allVisitors.add(event.visitorId);

            if (isTimestampWithinWindow(event.timestamp, window)) {
                intervalVisitors.add(event.visitorId);
            }

            if (isTimestampWithinWindow(event.timestamp, dayWindow)) {
                visitorsToday.add(event.visitorId);
            }

            if (isTimestampWithinWindow(event.timestamp, weekWindow)) {
                visitorsThisWeek.add(event.visitorId);
            }
        }
    } catch (error) {
        if (!error || error.code !== 'ENOENT') {
            throw error;
        }
    }

    const conversionRate = intervalVisitors.size > 0
        ? ((totalLeads / intervalVisitors.size) * 100).toFixed(1)
        : '0.0';

    const lines = [
        `Statistics computed for interval ${interval}.`,
        `Interval: ${interval}`,
        `Window Start: ${window.start.toISOString()}`,
        `Window End: ${window.end.toISOString()}`,
        `Total Unique Visitors: ${allVisitors.size}`,
        `Visitors in Interval: ${intervalVisitors.size}`,
        `Visitors Today: ${visitorsToday.size}`,
        `Visitors This Week: ${visitorsThisWeek.size}`,
        `Total Sessions: ${totalSessions}`,
        `Total Leads: ${totalLeads}`,
        `Lead Conversion (Leads/Visitors): ${conversionRate}%`,
        'Leads By Profile:',
    ];
    const profileEntries = Object.entries(leadsByProfile).sort((left, right) => left[0].localeCompare(right[0]));
    lines.push(...(profileEntries.length > 0
        ? profileEntries.map(([profile, count]) => `- ${profile}: ${count}`)
        : ['- *None*']));
    return lines.join('\n');
}
