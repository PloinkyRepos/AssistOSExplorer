#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configureDataStore, resolveDataDir } from '../runtime/dataStore.mjs';
import { executeWacModule } from '../runtime/execute-wac-module.mjs';
import { saveWacDocuments } from '../runtime/wac-to-datastore.mjs';

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
    const dataDir = typeof input.dataDir === 'string' && input.dataDir.trim()
        ? input.dataDir.trim()
        : undefined;

    const siteId = deriveSiteId(siteUrl);
    configureDataStore({ agentRoot, dataDir, siteId });

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

    try {
        const { exports, documents } = await executeWacModule({
            sourceCode,
            siteUrl,
            timeout: 5000,
        });

        const saveResult = await saveWacDocuments({ store, documents });

        const siteInfo = exports.describeSite ? await exports.describeSite() : null;
        const interactionConfig = exports.configureInteraction ? await exports.configureInteraction() : null;

        process.stdout.write(JSON.stringify({
            ok: true,
            siteId,
            siteUrl,
            documentsLoaded: documents.length,
            saved: saveResult,
            siteInfo: siteInfo || null,
            interactionConfig: interactionConfig || null,
        }, null, 2));
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
