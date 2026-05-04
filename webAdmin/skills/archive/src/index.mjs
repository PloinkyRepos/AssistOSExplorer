import fs from 'node:fs/promises';
import path from 'node:path';

import {
    getConfiguredDataDir,
} from '../../../src/runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    getSessionHistoryFileName,
    getSessionProfileFileName,
} from '../../../src/constants/datastore.mjs';

const ALLOWED_TARGETS = new Set(['all', 'session', 'lead', 'visitors']);
const VISITORS_LOG_FILE = 'visitors.log';

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('archive expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('archive input must be an object.');
    }
    return parsed;
}

function normalizeSessionIds(payload, target) {
    if (target === 'visitors') {
        return [];
    }

    if (typeof payload.sessionId === 'string' && payload.sessionId.trim()) {
        return [payload.sessionId.trim()];
    }

    if (!Array.isArray(payload.sessionIds)) {
        throw new Error('sessionIds is required and must be an array of strings.');
    }

    const unique = [];
    const seen = new Set();
    for (const value of payload.sessionIds) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        unique.push(normalized);
    }

    if (unique.length === 0) {
        throw new Error('sessionIds must contain at least one non-empty value.');
    }
    return unique;
}

function normalizeTarget(payload) {
    const raw = typeof payload.target === 'string'
        ? payload.target
        : (typeof payload.what === 'string' ? payload.what : 'all');
    const normalized = raw.trim().toLowerCase();
    if (!ALLOWED_TARGETS.has(normalized)) {
        throw new Error(`Invalid target: ${raw}`);
    }
    return normalized;
}

function getSessionLeadFileName(sessionId) {
    return `${sessionId}-lead`;
}

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function moveFileToArchive({ dataDir, sourcePath, destinationPath }) {
    const sourceExists = await pathExists(sourcePath);
    if (!sourceExists) {
        return { status: 'skipped', source: sourcePath, destination: destinationPath };
    }

    const archiveDir = path.dirname(destinationPath);
    await fs.mkdir(archiveDir, { recursive: true });

    const destinationExists = await pathExists(destinationPath);
    if (destinationExists) {
        return { status: 'already_archived', source: sourcePath, destination: destinationPath };
    }

    await fs.rename(sourcePath, destinationPath);
    return { status: 'archived', source: sourcePath, destination: destinationPath };
}

function buildSessionTargets(dataDir, sessionId, target) {
    const items = [];
    if (target === 'all' || target === 'session') {
        items.push({
            source: path.join(dataDir, DATASTORE_TYPES.SESSIONS, `${getSessionProfileFileName(sessionId)}.md`),
            destination: path.join(dataDir, 'archive', DATASTORE_TYPES.SESSIONS, `${getSessionProfileFileName(sessionId)}.md`),
            label: `sessions/${getSessionProfileFileName(sessionId)}.md`,
        });
        items.push({
            source: path.join(dataDir, DATASTORE_TYPES.SESSIONS, `${getSessionHistoryFileName(sessionId)}.md`),
            destination: path.join(dataDir, 'archive', DATASTORE_TYPES.SESSIONS, `${getSessionHistoryFileName(sessionId)}.md`),
            label: `sessions/${getSessionHistoryFileName(sessionId)}.md`,
        });
    }
    if (target === 'all' || target === 'lead') {
        items.push({
            source: path.join(dataDir, DATASTORE_TYPES.LEADS, `${getSessionLeadFileName(sessionId)}.md`),
            destination: path.join(dataDir, 'archive', DATASTORE_TYPES.LEADS, `${getSessionLeadFileName(sessionId)}.md`),
            label: `leads/${getSessionLeadFileName(sessionId)}.md`,
        });
    }
    return items;
}

export async function action({ promptText }) {
    let payload;
    try {
        payload = parseInput(promptText);
    } catch (error) {
        return error?.message || 'Invalid input.';
    }

    let target;
    try {
        target = normalizeTarget(payload);
    } catch (error) {
        return error?.message || 'Invalid archive request.';
    }

    let sessionIds;
    try {
        sessionIds = normalizeSessionIds(payload, target);
    } catch (error) {
        return error?.message || 'Invalid archive request.';
    }

    const dataDir = getConfiguredDataDir();
    const archived = [];
    const alreadyArchived = [];

    if (target === 'visitors') {
        const sourcePath = path.join(dataDir, VISITORS_LOG_FILE);
        const destinationPath = path.join(dataDir, 'archive', VISITORS_LOG_FILE);
        const result = await moveFileToArchive({ dataDir, sourcePath, destinationPath });
        if (result.status === 'archived') {
            archived.push({ label: VISITORS_LOG_FILE, source: result.source, destination: result.destination });
        } else if (result.status === 'already_archived') {
            alreadyArchived.push({ label: VISITORS_LOG_FILE, destination: result.destination });
        }
    } else {
        for (const sessionId of sessionIds) {
            const targets = buildSessionTargets(dataDir, sessionId, target);
            for (const item of targets) {
                const result = await moveFileToArchive({
                    dataDir,
                    sourcePath: item.source,
                    destinationPath: item.destination,
                });
                if (result.status === 'archived') {
                    archived.push({ label: item.label, source: result.source, destination: result.destination });
                } else if (result.status === 'already_archived') {
                    alreadyArchived.push({ label: item.label, destination: result.destination });
                }
            }
        }
    }

    const lines = [
        `Archive completed.`,
        `Target: ${target}`,
        `Archived files: ${archived.length}`,
        `Already archived files: ${alreadyArchived.length}`,
    ];

    if (archived.length > 0) {
        lines.push('Archived:');
        lines.push(...archived.map((item) => `- ${item.label} -> archive/${item.label}`));
    }

    if (alreadyArchived.length > 0) {
        lines.push('Already archived:');
        lines.push(...alreadyArchived.map((item) => `- archive/${item.label}`));
    }

    if (archived.length === 0 && alreadyArchived.length === 0) {
        lines.push('No files were found to archive.');
    }

    return lines.join('\n');
}
