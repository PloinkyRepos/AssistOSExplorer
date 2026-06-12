#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSiteId } from '../runtime/akuStore.mjs';

const REQUIRED_FIELDS = ['siteInfo', 'profilesInfo', 'contactInfo', 'siteMap'];
const OPENCODE_AGENT = 'opencodeAgent';
const EXECUTE_TASK_TOOL = 'execute-task';
const DEFAULT_OPENCODE_MODEL = 'opencode/deepseek-v4-flash-free';
const WAC_CACHE_FILE = 'wac-cache.json';

async function createAgentMcpClient(agentName) {
    const agentLibDir = String(process.env.PLOINKY_AGENT_LIB_DIR || '/Agent').replace(/\/+$/, '');
    const modulePath = String(process.env.WEBASSIST_AGENT_MCP_CLIENT_MODULE || `${agentLibDir}/client/AgentMcpClient.mjs`).trim();
    const module = await import(modulePath);
    if (!module || typeof module.createAgentClient !== 'function') {
        throw new Error(`AgentMcpClient module ${modulePath} does not export createAgentClient.`);
    }
    return module.createAgentClient(agentName);
}

function deriveSiteId(siteUrl) {
    try {
        const url = new URL(siteUrl);
        const host = url.hostname.replace(/^www\./, '');
        return host.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    } catch {
        throw new Error(`Invalid siteUrl: ${siteUrl}`);
    }
}

export function normalizeSiteUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    if (!/^https?:\/\//i.test(raw)) {
        return `https://${raw}`;
    }
    return raw.replace(/\/+$/, '');
}

export function resolveOpenCodeModel(env = process.env) {
    return (typeof env.WEBASSIST_OPENCODE_MODEL === 'string' ? env.WEBASSIST_OPENCODE_MODEL.trim() : '') ||
        DEFAULT_OPENCODE_MODEL;
}

export function isRunningInContainer() {
    return process.env.container === 'podman' ||
           process.env.CONTAINER === 'podman' ||
           process.env.CONTAINER === 'docker' ||
           process.env.KUBERNETES_SERVICE_HOST !== undefined ||
           process.env.PLOINKY_CONTAINER_NAME !== undefined ||
           false;
}

export function resolveLocalhostForContainer(siteUrl) {
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

export function validateWacJson(data) {
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

function resolveSiteProjectDir(agentRoot, siteId, dataDir) {
    const dataRoot = path.resolve(resolveDataDir(agentRoot, dataDir));
    return path.join(dataRoot, 'sites', normalizeSiteId(siteId));
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

export function resolveWacCachePath(dataDir) {
    return path.join(path.resolve(dataDir), WAC_CACHE_FILE);
}

export function computeWacTimestamp(text, headers = null) {
    const lastModified = headers && typeof headers.get === 'function'
        ? String(headers.get('last-modified') || '').trim()
        : '';
    if (lastModified) {
        return lastModified;
    }
    return `sha256:${crypto.createHash('sha256').update(String(text ?? '')).digest('hex')}`;
}

export async function readWacCache(cachePath) {
    try {
        const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
            return { schema: 1, entries: {} };
        }
        return {
            schema: 1,
            entries: parsed.entries,
        };
    } catch {
        return { schema: 1, entries: {} };
    }
}

export async function writeWacCache(cachePath, cache) {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const tempPath = path.join(
        path.dirname(cachePath),
        `.${path.basename(cachePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
    );
    const content = `${JSON.stringify({
        schema: 1,
        entries: cache.entries && typeof cache.entries === 'object' ? cache.entries : {},
    }, null, 2)}${os.EOL}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, cachePath);
}

async function fileExists(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile();
    } catch {
        return false;
    }
}

export function prepareWacForAkuPrompt(wacData) {
    return {
        ...wacData,
        siteMap: Array.isArray(wacData.siteMap)
            ? wacData.siteMap.map((url) => resolveLocalhostForContainer(String(url)))
            : wacData.siteMap,
    };
}

export function buildAkuPrompt(wacData) {
    const wacJson = JSON.stringify(wacData, null, 2);
    return [
        'Use the create-akus skill to transform the following WAC.json data into knowledge units in the current directory.',
        'Fetch every URL listed in siteMap and use the fetched content as source material for document knowledge units.',
        'If a siteMap URL cannot be fetched, record the failed URL in the AKU output and do not invent source content.',
        '',
        'WAC.json:',
        wacJson,
        '',
        'Create the .aku/ directory structure with site, profile, contact, and fetched document knowledge units in the current working directory.',
    ].join('\n');
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
    const model = resolveOpenCodeModel();
    const siteId = deriveSiteId(siteUrl);
    const fetchUrl = `${resolveLocalhostForContainer(siteUrl)}/WAC.json`;

    let wacData;
    let wacTimestamp;
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
        wacTimestamp = computeWacTimestamp(text, response.headers);
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

    const projectDir = resolveSiteProjectDir(agentRoot, siteId, resolvedDataDir);
    const akuDir = path.join(projectDir, '.aku');
    const akuManifestPath = path.join(akuDir, 'aku.json');
    const cachePath = resolveWacCachePath(resolvedDataDir);
    const cache = await readWacCache(cachePath);
    const cachedEntry = cache.entries[siteUrl];

    if (
        cachedEntry &&
        cachedEntry.wacTimestamp === wacTimestamp &&
        await fileExists(akuManifestPath)
    ) {
        process.stdout.write(JSON.stringify({
            ok: true,
            siteId,
            siteUrl,
            akuBuilt: false,
            cacheHit: true,
            wacTimestamp,
            cachePath,
            projectDir,
            akuDir,
            model,
        }));
        return;
    }

    const prompt = buildAkuPrompt(prepareWacForAkuPrompt(wacData));

    try {
        const opencodeClient = await createAgentMcpClient(OPENCODE_AGENT);
        await opencodeClient.callTool(EXECUTE_TASK_TOOL, {
            prompt,
            projectDir,
            model,
        });

        cache.entries[siteUrl] = {
            siteUrl,
            siteId,
            wacTimestamp,
            updatedAt: new Date().toISOString(),
            projectDir,
            akuDir,
        };
        await writeWacCache(cachePath, cache);

        process.stdout.write(JSON.stringify({
            ok: true,
            siteId,
            siteUrl,
            akuBuilt: true,
            cacheHit: false,
            wacTimestamp,
            cachePath,
            projectDir,
            akuDir,
            model,
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
