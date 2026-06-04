#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDataDir } from '../runtime/dataStore.mjs';

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

export async function listSites({
    agentRoot = getDefaultAgentRoot(),
    dataDir = null,
} = {}) {
    const resolvedAgentRoot = path.resolve(agentRoot);
    const resolvedDataDir = resolveDataDir(resolvedAgentRoot, dataDir);
    const sitesDir = path.join(resolvedDataDir, 'sites');

    try {
        const entries = await fs.readdir(sitesDir, { withFileTypes: true });
        const siteIds = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();

        return {
            sites: siteIds,
            count: siteIds.length,
            dataDir: resolvedDataDir,
        };
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return {
                sites: [],
                count: 0,
                dataDir: resolvedDataDir,
            };
        }
        throw error;
    }
}

async function main() {
    const rawInput = await readStdinFallback();
    const envelope = rawInput && rawInput.trim() ? safeParseJson(rawInput) : null;
    const input = normalizeInput(envelope || {});

    const result = await listSites({
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
