#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureDataStore, getDataStore } from '../runtime/dataStore.mjs';

const EVENTS_LOG_FILE = 'events';

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

function normalizeVisitorId(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
        throw new Error('register-events requires visitorId.');
    }
    const safe = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
    const normalized = safe.replace(/^[-.]+|[-.]+$/g, '');
    if (!normalized) {
        throw new Error('register-events requires a valid visitorId.');
    }
    return normalized;
}

function normalizeEventType(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
        throw new Error('register-events requires eventType.');
    }
    return raw;
}

export async function registerEvent({
    siteId,
    visitorId,
    eventType,
    sessionId = '',
    referrer = '',
    country = '',
    openedChat = false,
    details = {},
    agentRoot = getDefaultAgentRoot(),
    dataDir = null,
}) {
    if (!siteId) {
        throw new Error('register-events requires siteId.');
    }
    const normalizedVisitorId = normalizeVisitorId(visitorId);
    const normalizedEventType = normalizeEventType(eventType);
    const resolvedAgentRoot = path.resolve(agentRoot);
    configureDataStore({
        agentRoot: resolvedAgentRoot,
        dataDir,
        siteId,
    });
    const store = getDataStore();
    const nowIso = new Date().toISOString();

    const entryFields = {
        'Event Type': normalizedEventType,
        'Visitor ID': normalizedVisitorId,
        Timestamp: nowIso,
    };

    if (sessionId) {
        entryFields['Session ID'] = String(sessionId).trim();
    }
    if (typeof referrer === 'string' && referrer.trim()) {
        entryFields.Referrer = referrer.trim();
    }
    if (typeof country === 'string' && country.trim()) {
        entryFields.Country = country.trim();
    }
    if (normalizedEventType === 'visit' || normalizedEventType === 'chat-start') {
        entryFields['Opened Chat'] = openedChat === true ? 'yes' : 'no';
    }
    if (details && typeof details === 'object' && !Array.isArray(details)) {
        for (const [key, value] of Object.entries(details)) {
            entryFields[String(key)] = String(value ?? '');
        }
    }

    await store.appendToFile('visits', EVENTS_LOG_FILE, {
        sections: {
            'Event Entry': store.renderKeyValue(entryFields),
        },
    });

    return {
        ok: true,
        siteId,
        visitorId: normalizedVisitorId,
        eventType: normalizedEventType,
        logPath: `visits/${EVENTS_LOG_FILE}.md`,
        timestamp: nowIso,
    };
}

async function main() {
    const rawInput = await readStdinFallback();
    const envelope = rawInput && rawInput.trim() ? safeParseJson(rawInput) : null;
    const input = normalizeInput(envelope || {});

    const result = await registerEvent({
        siteId: typeof input.siteId === 'string' ? input.siteId.trim() : '',
        visitorId: input.visitorId,
        eventType: typeof input.eventType === 'string' ? input.eventType.trim() : '',
        sessionId: typeof input.sessionId === 'string' ? input.sessionId.trim() : '',
        referrer: typeof input.referrer === 'string' ? input.referrer.trim() : '',
        country: typeof input.country === 'string' ? input.country.trim() : '',
        openedChat: input.openedChat === true,
        details: input.details && typeof input.details === 'object' ? input.details : {},
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
