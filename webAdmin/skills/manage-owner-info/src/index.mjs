import fs from 'node:fs/promises';
import path from 'node:path';

import { getConfiguredDataDir, getDataStore } from '../../../src/runtime/dataStore.mjs';
import { DATASTORE_TYPES } from '../../../src/constants/datastore.mjs';

const PREFIXES = [
    { key: 'email', label: 'Email:' },
    { key: 'phone', label: 'Phone:' },
    { key: 'calendar', label: 'Calendar:' },
    { key: 'meeting', label: 'Meeting:' },
];

function parseInput(promptText) {
    let parsed;
    try {
        parsed = JSON.parse(String(promptText ?? '{}'));
    } catch {
        throw new Error('manage-owner-info expects promptText to be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('manage-owner-info input must be an object.');
    }
    return parsed;
}

function normalizeLine(line) {
    return String(line || '').trim();
}

function updateLines(existingLines, updates) {
    const lines = existingLines.map(normalizeLine).filter(Boolean);
    const remaining = new Set(Object.keys(updates));

    const nextLines = lines.map((line) => {
        for (const { key, label } of PREFIXES) {
            if (!updates[key]) {
                continue;
            }
            if (line.toLowerCase().startsWith(label.toLowerCase())) {
                remaining.delete(key);
                return `${label} ${updates[key]}`;
            }
        }
        return line;
    });

    for (const { key, label } of PREFIXES) {
        if (remaining.has(key) && updates[key]) {
            nextLines.push(`${label} ${updates[key]}`);
        }
    }

    return nextLines;
}

async function readOwnerFile(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return '';
        }
        throw error;
    }
}

export async function action({ promptText }) {
    let payload;
    try {
        payload = parseInput(promptText);
    } catch (error) {
        const message = error?.message || 'Invalid input.';
        return message;
    }

    const store = getDataStore();
    const dataDir = getConfiguredDataDir();
    const configDir = path.join(dataDir, DATASTORE_TYPES.CONFIG);
    const ownerPath = path.join(configDir, 'owner.md');

    if (payload.read === true) {
        const content = await readOwnerFile(ownerPath);
        return [
            'Owner info loaded.',
            '',
            content.trim() || '*None*',
        ].join('\n');
    }

    if (typeof payload.content === 'string' && payload.content.trim()) {
        try {
            const current = await store.getFile(DATASTORE_TYPES.CONFIG, 'owner');
            if (current.sections.length > 0) {
                await store.deleteFile(DATASTORE_TYPES.CONFIG, 'owner', current.sections.map((section) => section.index));
            }
        } catch (error) {
            if (!error || error.code !== 'ENOENT') {
                throw error;
            }
        }
        await store.updateFile(DATASTORE_TYPES.CONFIG, 'owner', { Content: payload.content.trim() });
        return 'Owner info replaced.';
    }

    const updates = {};
    for (const { key } of PREFIXES) {
        if (typeof payload[key] === 'string' && payload[key].trim()) {
            updates[key] = payload[key].trim();
        }
    }

    if (Object.keys(updates).length === 0) {
        const message = 'No updates provided.';
        return message;
    }

    await fs.mkdir(configDir, { recursive: true });
    const existing = await readOwnerFile(ownerPath);
    const lines = existing ? existing.split(/\r?\n/) : [];
    const updatedLines = updateLines(lines, updates);
    await fs.writeFile(ownerPath, `${updatedLines.join('\n')}\n`, 'utf8');

    return [
        'Owner info updated.',
        'Updated fields:',
        ...Object.entries(updates).map(([key, value]) => `- ${key}: ${value}`),
    ].join('\n');
}
