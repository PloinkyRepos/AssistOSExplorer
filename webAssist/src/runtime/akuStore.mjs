import path from 'node:path';

export function normalizeSiteId(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
        throw new Error('siteId is required.');
    }

    const normalized = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
    if (!normalized) {
        throw new Error('siteId must be a valid site identifier.');
    }
    return normalized;
}

export function resolveDataDir(agentRoot, explicitDataDir = null) {
    if (explicitDataDir) {
        return path.resolve(explicitDataDir);
    }
    const workspacePath = process.env.WORKSPACE_PATH;
    if (!workspacePath) {
        throw new Error('WORKSPACE_PATH is required to resolve the data directory.');
    }
    return path.join(workspacePath, 'data');
}

export function resolveSiteDataDir(dataRoot, siteId) {
    return path.join(path.resolve(dataRoot), 'sites', normalizeSiteId(siteId));
}

export function resolveSiteAkuDir(agentRoot, siteId, explicitDataDir = null) {
    const dataRoot = resolveDataDir(agentRoot, explicitDataDir);
    const siteDir = resolveSiteDataDir(dataRoot, siteId);
    return path.join(siteDir, '.aku');
}

export function resolveDataRoot(agentRoot, explicitDataDir = null) {
    return resolveDataDir(agentRoot, explicitDataDir);
}
