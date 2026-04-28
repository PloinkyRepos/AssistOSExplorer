#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureDataStore, getDataStore } from '../runtime/dataStore.mjs';
import {
    DATASTORE_TYPES,
    SESSION_SECTIONS,
    getSessionHistoryFileName,
} from '../constants/datastore.mjs';

function getDefaultAgentRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function safeParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function normalizeInput(envelope) {
    let current = envelope;
    for (let index = 0; index < 4; index += 1) {
        if (!current || typeof current !== 'object') {
            break;
        }
        if (current.input && typeof current.input === 'object') {
            current = current.input;
            continue;
        }
        if (current.arguments && typeof current.arguments === 'object') {
            current = current.arguments;
            continue;
        }
        if (current.params?.arguments && typeof current.params.arguments === 'object') {
            current = current.params.arguments;
            continue;
        }
        if (current.params?.input && typeof current.params.input === 'object') {
            current = current.params.input;
            continue;
        }
        break;
    }
    return current && typeof current === 'object' ? current : {};
}

async function readStdinFallback() {
    if (process.stdin.isTTY) {
        return '';
    }
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('end', () => {
            resolve(data);
        });
        process.stdin.on('error', () => {
            resolve('');
        });
    });
}

export async function getSessionHistory({
    sessionId,
    agentRoot = getDefaultAgentRoot(),
    dataDir = null,
}) {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
        throw new Error('web_cli_history requires sessionId.');
    }

    const resolvedAgentRoot = path.resolve(agentRoot);
    configureDataStore({
        agentRoot: resolvedAgentRoot,
        dataDir,
    });

    const store = getDataStore();
    const historyFileName = getSessionHistoryFileName(normalizedSessionId);

    try {
        const record = await store.getSectionMap(DATASTORE_TYPES.SESSIONS, historyFileName);
        const history = store.parseDialogue(record.sections?.[SESSION_SECTIONS.HISTORY]).map((entry) => ({
            role: String(entry.speaker ?? '').trim().toLowerCase(),
            message: String(entry.message ?? '').trim(),
        }));

        return {
            sessionId: normalizedSessionId,
            exists: true,
            sessionHistoryPath: `${historyFileName}.md`,
            history,
        };
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return {
                sessionId: normalizedSessionId,
                exists: false,
                sessionHistoryPath: `${historyFileName}.md`,
                history: [],
            };
        }
        throw error;
    }
}

async function main() {
    const rawInput = await readStdinFallback();
    const envelope = rawInput && rawInput.trim() ? safeParseJson(rawInput) : null;
    const input = normalizeInput(envelope || {});

    const result = await getSessionHistory({
        sessionId: typeof input.sessionId === 'string' ? input.sessionId.trim() : '',
        dataDir: typeof input.dataDir === 'string' ? input.dataDir.trim() : null,
        agentRoot: typeof input.agentRoot === 'string' ? input.agentRoot.trim() : getDefaultAgentRoot(),
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
