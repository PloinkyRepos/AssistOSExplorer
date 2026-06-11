#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSiteAkuDir, normalizeSiteId } from '../runtime/akuStore.mjs';

const REQUIRED_FIELDS = ['siteInfo', 'profilesInfo', 'contactInfo', 'siteMap'];
const OPENCODE_AGENT = 'opencodeAgent';
const EXECUTE_TASK_TOOL = 'execute-task';
const OPENCODE_TIMEOUT_MS = 270000;

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

function validateWacJson(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
        errors.push('WAC.json must be a JSON object');
        return errors;
    }

    for (const field of REQUIRED_FIELDS) {
        if (!(field in data)) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    if (typeof data.siteInfo !== 'string' || !data.siteInfo.trim()) {
        errors.push('siteInfo must be a non-empty string');
    }

    if (data.profilesInfo !== null && typeof data.profilesInfo !== 'object') {
        errors.push('profilesInfo must be a JSON object');
    }

    if (typeof data.contactInfo !== 'string') {
        errors.push('contactInfo must be a string');
    }

    if (!Array.isArray(data.siteMap)) {
        errors.push('siteMap must be an array of URLs');
    } else {
        for (let i = 0; i < data.siteMap.length; i++) {
            try {
                new URL(data.siteMap[i]);
            } catch {
                errors.push(`Invalid URL in siteMap at index ${i}: ${data.siteMap[i]}`);
            }
        }
    }

    return errors;
}

function resolveRouterUrl() {
    const explicit = String(process.env.PLOINKY_ROUTER_URL || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const host = String(process.env.PLOINKY_ROUTER_HOST || '127.0.0.1').trim() || '127.0.0.1';
    const port = String(process.env.PLOINKY_ROUTER_PORT || '8080').trim() || '8080';
    return `http://${host}:${port}`;
}

async function callAgentTool(agent, toolName, input, options = {}) {
    const base = resolveRouterUrl();
    const url = new URL(`/mcps/${encodeURIComponent(agent)}/mcp`, base);
    const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
    };
    if (options.invocationToken) {
        headers['x-ploinky-caller-jwt'] = options.invocationToken;
    }
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || OPENCODE_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: { name: toolName, arguments: input || {} },
            }),
            signal: controller.signal,
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok || parsed?.error) {
            throw new Error(parsed?.error?.message || `router responded ${response.status}`);
        }
        return parsed;
    } finally {
        clearTimeout(timer);
    }
}

function buildAkuPrompt(wacData, siteId) {
    const pageCount = Array.isArray(wacData.siteMap) ? wacData.siteMap.length : 0;
    const profileCount = typeof wacData.profilesInfo === 'object' && wacData.profilesInfo !== null
        ? Object.keys(wacData.profilesInfo).length
        : 0;

    return [
        `Build AKU (Agentic Knowledge Units) for site-id: ${siteId}.`,
        '',
        `Site Info: ${wacData.siteInfo}`,
        `Contact Info: ${wacData.contactInfo}`,
        `Profiles (${profileCount}): ${JSON.stringify(wacData.profilesInfo, null, 2)}`,
        `SiteMap (${pageCount} pages): ${JSON.stringify(wacData.siteMap, null, 2)}`,
        '',
        'Create the AKU structure in the target directory with appropriate knowledge units for site context, profiles, and contact information.',
        'Store all knowledge units under the .aku/ directory.',
    ].join('\n');
}

function resolveAkuDir(agentRoot, siteId, dataDir) {
    const dataRoot = path.resolve(resolveDataDir(agentRoot, dataDir));
    return path.join(dataRoot, 'sites', normalizeSiteId(siteId), '.aku');
}

function resolveDataDir(agentRoot, explicitDataDir) {
    if (explicitDataDir) {
        return path.resolve(explicitDataDir);
    }
    const workspacePath = process.env.WORKSPACE_PATH;
    if (!workspacePath) {
        throw new Error('WORKSPACE_PATH is required to resolve the data directory.');
    }
    return path.join(workspacePath, 'data');
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
    const invocationToken = typeof input.invocationToken === 'string' ? input.invocationToken.trim() : '';

    const siteId = deriveSiteId(siteUrl);
    const fetchUrl = `${resolveLocalhostForContainer(siteUrl)}/WAC.json`;

    let wacData;
    try {
        const response = await fetch(fetchUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            process.stdout.write(JSON.stringify({
                ok: false,
                error: `Failed to fetch WAC.json: HTTP ${response.status}`,
                siteId,
                siteUrl,
                url: fetchUrl,
            }));
            return;
        }
        const text = await response.text();
        wacData = JSON.parse(text);
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: `Failed to fetch WAC.json: ${error.message}`,
            siteId,
            siteUrl,
            url: fetchUrl,
        }));
        return;
    }

    const validationErrors = validateWacJson(wacData);
    if (validationErrors.length > 0) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: 'WAC.json validation failed',
            errors: validationErrors,
            siteId,
            siteUrl,
        }));
        process.exitCode = 1;
        return;
    }

    const akuDir = resolveAkuDir(agentRoot, siteId, resolvedDataDir);
    const prompt = buildAkuPrompt(wacData, siteId);

    try {
        await callAgentTool(OPENCODE_AGENT, EXECUTE_TASK_TOOL, {
            prompt,
            projectDir: akuDir,
        }, {
            invocationToken,
            timeoutMs: OPENCODE_TIMEOUT_MS,
        });

        process.stdout.write(JSON.stringify({
            ok: true,
            siteId,
            siteUrl,
            akuBuilt: true,
            akuDir,
        }));
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: `Failed to build AKU via opencode-agent: ${error.message}`,
            siteId,
            siteUrl,
            akuBuilt: false,
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
