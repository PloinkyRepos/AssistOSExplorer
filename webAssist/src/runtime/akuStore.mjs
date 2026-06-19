import fs from 'node:fs';
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

export function resolveWebAssistDataRoot() {
    const workspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT;
    if (!workspaceRoot) {
        throw new Error('PLOINKY_WORKSPACE_ROOT is required to resolve the webAssist data directory.');
    }

    const dataRoot = path.join(path.resolve(workspaceRoot), 'webassist-data');
    if (!fs.existsSync(dataRoot)) {
        throw new Error(`webAssist data directory does not exist: ${dataRoot}`);
    }
    return dataRoot;
}

export function resolveSiteDataDir(siteId) {
    return path.join(resolveWebAssistDataRoot(), 'sites', normalizeSiteId(siteId));
}

export function resolveSiteAkuDir(siteId) {
    return path.join(resolveSiteDataDir(siteId), '.aku');
}

export function resolveDataRoot() {
    return resolveWebAssistDataRoot();
}
