#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSiteId } from '../runtime/akuStore.mjs';

const REQUIRED_FIELDS = ['siteInfo', 'profilesInfo', 'contactInfo', 'siteMap'];
const OPENCODE_AGENT = 'opencodeAgent';
const EXECUTE_TASK_TOOL = 'execute-task';
const DEFAULT_OPENCODE_MODEL = 'opencode/deepseek-v4-flash-free';

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
    const model = typeof input.model === 'string' && input.model.trim()
        ? input.model.trim()
        : DEFAULT_OPENCODE_MODEL;
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

    const projectDir = resolveSiteProjectDir(agentRoot, siteId, resolvedDataDir);
    const prompt = buildAkuPrompt(prepareWacForAkuPrompt(wacData));

    try {
        const opencodeClient = await createAgentMcpClient(OPENCODE_AGENT);
        await opencodeClient.callTool(EXECUTE_TASK_TOOL, {
            prompt,
            projectDir,
            model,
        });

        process.stdout.write(JSON.stringify({
            ok: true,
            siteId,
            siteUrl,
            akuBuilt: true,
            projectDir,
            akuDir: path.join(projectDir, '.aku'),
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
