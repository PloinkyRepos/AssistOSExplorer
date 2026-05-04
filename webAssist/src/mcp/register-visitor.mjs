#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDataDir } from '../runtime/dataStore.mjs';

const VISITORS_LOG_FILE = 'visitors.log';

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
        throw new Error('register-visitor requires visitorId.');
    }
    const safe = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
    const normalized = safe.replace(/^[-.]+|[-.]+$/g, '');
    if (!normalized) {
        throw new Error('register-visitor requires a valid visitorId.');
    }
    return normalized;
}

export async function registerVisitor({
    visitorId,
    agentRoot = getDefaultAgentRoot(),
    dataDir = null,
}) {
    const normalizedVisitorId = normalizeVisitorId(visitorId);
    const resolvedAgentRoot = path.resolve(agentRoot);
    const resolvedDataDir = resolveDataDir(resolvedAgentRoot, dataDir);
    const nowIso = new Date().toISOString();

    await fs.mkdir(resolvedDataDir, { recursive: true });
    const record = {
        timestamp: nowIso,
        visitorId: normalizedVisitorId,
        source: 'web-assist-chat',
        version: 1,
    };

    await fs.appendFile(path.join(resolvedDataDir, VISITORS_LOG_FILE), `${JSON.stringify(record)}\n`, 'utf8');

    return {
        ok: true,
        visitorId: normalizedVisitorId,
        logFile: VISITORS_LOG_FILE,
        lastVisit: nowIso,
    };
}

async function main() {
    const rawInput = await readStdinFallback();
    const envelope = rawInput && rawInput.trim() ? safeParseJson(rawInput) : null;
    const input = normalizeInput(envelope || {});

    const result = await registerVisitor({
        visitorId: input.visitorId,
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
