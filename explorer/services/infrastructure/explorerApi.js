import { callToolWithLoader } from '../../utils/globalLoader.js';

export class ToolError extends Error {
    constructor(code, message, data = null) {
        super(message);
        this.name = 'ToolError';
        this.code = code;
        this.data = data;
    }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const MISSING_SESSION_TEXT = 'Missing or invalid MCP session';
let sessionPromptActive = false;
const PATH_AGENT_NAMES = new Set(['gitAgent', 'tasksAgent']);
let cachedReposRootAbs = '';
let reposRootPromise = null;

const isMissingSessionError = (error) => {
    const message = error?.message || error?.toString?.() || '';
    return typeof message === 'string' && message.includes(MISSING_SESSION_TEXT);
};

const handleMissingSession = async () => {
    if (sessionPromptActive) return;
    sessionPromptActive = true;
    try {
        const confirmed = await assistOS.UI.showModal(
            'confirm-action-modal',
            { message: 'Session expired. Reload the app to reconnect.' },
            true
        );
        if (confirmed) {
            window.location.reload();
        }
    } finally {
        setTimeout(() => {
            sessionPromptActive = false;
        }, 500);
    }
};

export function parseToolResult(payload) {
    if (!payload) return null;
    if (typeof payload !== 'string') {
        if (Object.prototype.hasOwnProperty.call(payload, 'json')) {
            return payload.json;
        }
        const blocks = Array.isArray(payload.content) ? payload.content : null;
        if (blocks) {
            const jsonBlock = blocks.find((block) => block?.type === 'json' && block.json !== undefined);
            if (jsonBlock) return jsonBlock.json;
            const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
            if (textBlock?.text) {
                try {
                    return JSON.parse(textBlock.text);
                } catch {
                    return null;
                }
            }
        }
        if (typeof payload.text === 'string') {
            const trimmed = payload.text.trim();
            if (trimmed) {
                try {
                    return JSON.parse(trimmed);
                } catch {
                    return null;
                }
            }
        }
        return payload;
    }

    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

export function extractToolText(payload) {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    const blocks = Array.isArray(payload.content) ? payload.content : null;
    if (blocks) {
        const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
        if (textBlock?.text) return textBlock.text;
    }
    if (typeof payload.text === 'string') {
        return payload.text;
    }
    return '';
}

export function ensureSuccess(payload) {
    const text = extractToolText(payload);
    if (isNonEmptyString(text) && text.trim().startsWith('Error:')) {
        throw new ToolError('tool_error', text.trim().replace(/^Error:\s*/i, ''), { payload });
    }
    const parsed = parseToolResult(payload);
    if (parsed && typeof parsed === 'object') {
        const ok = Object.prototype.hasOwnProperty.call(parsed, 'ok') ? parsed.ok : null;
        if (ok === false) {
            const message = isNonEmptyString(parsed.error) ? parsed.error : 'Tool execution failed';
            throw new ToolError('tool_error', message, parsed);
        }
    }
}

async function resolveReposRootAbs() {
    if (cachedReposRootAbs) return cachedReposRootAbs;
    if (reposRootPromise) return reposRootPromise;
    reposRootPromise = (async () => {
        try {
            const gitClient = window.webSkel?.appServices?.getClient?.('gitAgent');
            if (!gitClient || typeof gitClient.callTool !== 'function') {
                return cachedReposRootAbs;
            }
            const result = await gitClient.callTool('git_repos_overview', { path: '.ploinky/repos' });
            const parsed = parseToolResult(result);
            const root = parsed?.reposRoot;
            if (isNonEmptyString(root) && root.startsWith('/')) {
                cachedReposRootAbs = root.trim().replace(/\/+$/g, '');
            }
        } catch {
            // ignore, fall back to empty
        } finally {
            reposRootPromise = null;
        }
        return cachedReposRootAbs;
    })();
    return reposRootPromise;
}

function toAbsoluteRepoPath(input, reposRootAbs) {
    const raw = String(input || '').trim();
    if (!raw) return raw;
    if (raw.startsWith('/.ploinky/repos')) {
        const suffix = raw.replace(/^\/\.ploinky\/repos/, '');
        if (!reposRootAbs) return '';
        return `${reposRootAbs}${suffix}`;
    }
    if (raw.startsWith('.ploinky/repos')) {
        const suffix = raw.replace(/^\.ploinky\/repos/, '');
        if (!reposRootAbs) return '';
        return `${reposRootAbs}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
    }
    return raw;
}

async function normalizeAgentArgs(agentName, toolName, args) {
    if (!PATH_AGENT_NAMES.has(agentName)) {
        return args;
    }
    if (toolName === 'git_repos_overview') {
        return args;
    }
    const needsResolve = (() => {
        const check = (value) => typeof value === 'string' && (value.startsWith('/.ploinky/') || value.startsWith('.ploinky/'));
        if (check(args?.path) || check(args?.repoPath) || check(args?.backlogPath)) return true;
        if (Array.isArray(args?.repoPaths) && args.repoPaths.some(check)) return true;
        return false;
    })();
    const reposRootAbs = needsResolve ? await resolveReposRootAbs() : '';
    const next = { ...(args || {}) };

    if (typeof next.path === 'string') {
        const resolved = needsResolve ? toAbsoluteRepoPath(next.path, reposRootAbs) : next.path;
        next.path = resolved;
    }
    if (typeof next.repoPath === 'string') {
        const resolved = needsResolve ? toAbsoluteRepoPath(next.repoPath, reposRootAbs) : next.repoPath;
        next.repoPath = resolved;
    }
    if (typeof next.backlogPath === 'string') {
        const resolved = needsResolve ? toAbsoluteRepoPath(next.backlogPath, reposRootAbs) : next.backlogPath;
        next.backlogPath = resolved;
    }
    if (Array.isArray(next.repoPaths)) {
        next.repoPaths = needsResolve
            ? next.repoPaths.map((entry) => toAbsoluteRepoPath(entry, reposRootAbs))
            : next.repoPaths;
    }

    const checkAbsolute = (value) => typeof value === 'string' && value.startsWith('/');
    if (next.path && !checkAbsolute(next.path)) {
        throw new ToolError('invalid_path', 'Path must be an absolute filesystem path.');
    }
    if (next.repoPath && !checkAbsolute(next.repoPath)) {
        throw new ToolError('invalid_path', 'repoPath must be an absolute filesystem path.');
    }
    if (next.backlogPath && !checkAbsolute(next.backlogPath)) {
        throw new ToolError('invalid_path', 'backlogPath must be an absolute filesystem path.');
    }
    if (Array.isArray(next.repoPaths) && next.repoPaths.some((entry) => entry && !checkAbsolute(entry))) {
        throw new ToolError('invalid_path', 'repoPaths must be absolute filesystem paths.');
    }

    return next;
}

export async function callExplorerTool(name, args, { raw = false } = {}) {
    try {
        const result = await callToolWithLoader('explorer', name, args);
        ensureSuccess(result);
        return raw ? result : extractToolText(result);
    } catch (error) {
        if (isMissingSessionError(error)) {
            await handleMissingSession();
        }
        throw error;
    }
}

export async function callAgentTool(agentName, name, args, { raw = false } = {}) {
    const client = window.webSkel?.appServices?.getClient?.(agentName);
    if (!client || typeof client.callTool !== 'function') {
        throw new ToolError('client_unavailable', `Agent client not available: ${agentName}`);
    }
    try {
        const normalizedArgs = await normalizeAgentArgs(agentName, name, args || {});
        const result = await client.callTool(name, normalizedArgs || {});
        ensureSuccess(result);
        return raw ? result : extractToolText(result);
    } catch (error) {
        if (isMissingSessionError(error)) {
            await handleMissingSession();
        }
        throw error;
    }
}
