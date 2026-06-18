import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DATA_DIR_NAME = 'webassist-data';

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
    const workspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT;
    if (!workspaceRoot) {
        throw new Error('PLOINKY_WORKSPACE_ROOT is required to resolve the webAssist data directory.');
    }

    const dataDir = path.join(workspaceRoot, DEFAULT_DATA_DIR_NAME);
    let dataDirStats = null;
    try {
        dataDirStats = fs.statSync(dataDir);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
    if (!dataDirStats?.isDirectory()) {
        throw new Error(`webAssist data directory does not exist: ${dataDir}`);
    }
    return dataDir;
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
