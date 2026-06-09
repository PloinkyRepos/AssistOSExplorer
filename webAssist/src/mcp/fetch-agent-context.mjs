#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { configureDataStore, resolveDataDir } from '../runtime/dataStore.mjs';
import { executeWacModule } from '../runtime/execute-wac-module.mjs';
import { saveWacDocuments } from '../runtime/wac-to-datastore.mjs';

const WAC_CACHE_TTL = 5 * 60 * 1000;

function deriveSiteId(siteUrl) {
    try {
        const url = new URL(siteUrl);
        const host = url.hostname.replace(/^www\./, '');
        return host.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    } catch {
        throw new Error(`Invalid siteUrl: ${siteUrl}`);
    }
}

function normalizeSiteUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    if (!/^https?:\/\//i.test(raw)) {
        return `https://${raw}`;
    }
    return raw.replace(/\/+$/, '');
}

function isRunningInContainer() {
    return process.env.container === 'podman' ||
           process.env.CONTAINER === 'podman' ||
           process.env.CONTAINER === 'docker' ||
           process.env.KUBERNETES_SERVICE_HOST !== undefined ||
           process.env.PLOINKY_CONTAINER_NAME !== undefined ||
           false;
}

function resolveLocalhostForContainer(siteUrl) {
    if (!isRunningInContainer()) {
        return siteUrl;
    }
    try {
        const url = new URL(siteUrl);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
            url.hostname = 'host.containers.internal';
            return url.toString().replace(/\/+$/, '');
        }
    } catch {
    }
    return siteUrl;
}

function computeSourceHash(sourceCode) {
    return createHash('sha256').update(sourceCode).digest('hex').slice(0, 16);
}

function resolveCachePath(dataDir) {
    return path.join(path.resolve(dataDir), 'wac-cache.json');
}

async function loadCache(dataDir) {
    try {
        const cachePath = resolveCachePath(dataDir);
        const raw = await fs.readFile(cachePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

async function saveCache(dataDir, cache) {
    try {
        const cachePath = resolveCachePath(dataDir);
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
    }
}

function getCacheEntry(cache, siteUrl, sourceHash) {
    const entry = cache[siteUrl];
    if (!entry) {
        return null;
    }
    const age = Date.now() - entry.timestamp;
    if (age > WAC_CACHE_TTL) {
        return null;
    }
    if (entry.sourceHash !== sourceHash) {
        return null;
    }
    return entry;
}

function setCacheEntry(cache, siteUrl, sourceHash, data) {
    cache[siteUrl] = {
        sourceHash,
        timestamp: Date.now(),
        data,
    };
}

async function main() {
    const stdinData = await new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                data += chunk;
            }
        });
        process.stdin.on('end', () => resolve(data));
    });

    let input;
    try {
        const parsed = JSON.parse(stdinData);
        input = parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed;
    } catch {
        input = {};
    }

    const siteUrl = normalizeSiteUrl(input.siteUrl);
    if (!siteUrl) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'siteUrl is required.' }));
        process.exitCode = 1;
        return;
    }

    const agentRoot = typeof input.agentRoot === 'string' && input.agentRoot.trim()
        ? input.agentRoot.trim()
        : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const resolvedDataDir = typeof input.dataDir === 'string' && input.dataDir.trim()
        ? input.dataDir.trim()
        : resolveDataDir(agentRoot, undefined);

    const siteId = deriveSiteId(siteUrl);
    configureDataStore({ agentRoot, dataDir: resolvedDataDir, siteId });

    const { getDataStore } = await import('../runtime/dataStore.mjs');
    const store = getDataStore();

    const contextPath = '/agent-context.mjs';
    const resolvedUrl = resolveLocalhostForContainer(siteUrl);
    const fetchUrl = `${resolvedUrl}${contextPath}`;

    let sourceCode;
    try {
        const response = await fetch(fetchUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            process.stdout.write(JSON.stringify({
                ok: false,
                error: `Failed to fetch agent-context.mjs: HTTP ${response.status}`,
                siteId,
                siteUrl,
                url: fetchUrl,
            }));
            return;
        }
        sourceCode = await response.text();
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: `Failed to fetch agent-context.mjs: ${error.message}`,
            siteId,
            siteUrl,
            url: fetchUrl,
        }));
        return;
    }

    if (!sourceCode || !sourceCode.trim()) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: 'agent-context.mjs is empty.',
            siteId,
            siteUrl,
        }));
        return;
    }

    const sourceHash = computeSourceHash(sourceCode);
    const cache = await loadCache(resolvedDataDir);
    const cached = getCacheEntry(cache, siteUrl, sourceHash);

    if (cached) {
        process.stdout.write(JSON.stringify({
            ok: true,
            siteId,
            siteUrl,
            cached: true,
        }));
        return;
    }

    try {
        const { exports, documents } = await executeWacModule({
            sourceCode,
            siteUrl: resolvedUrl,
            timeout: 5000,
        });

        const saveResult = await saveWacDocuments({ store, documents });

        setCacheEntry(cache, siteUrl, sourceHash, {
            documentsLoaded: documents.length,
            saved: saveResult,
        });
        await saveCache(resolvedDataDir, cache);

        process.stdout.write(JSON.stringify({
            ok: true,
            siteId,
            siteUrl,
            cached: false,
        }));
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: `Failed to execute agent-context.mjs: ${error.message}`,
            siteId,
            siteUrl,
        }));
        process.exitCode = 1;
    }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
