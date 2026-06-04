import path from 'node:path';

import { MarkdownDataStore } from 'achillesAgentLib';

let configuredDataRoot = null;
let configuredDataDir = null;
let configuredSiteId = null;
let dataStoreInstance = null;

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

export function resolveSiteDataDir(dataRoot, siteId) {
    return path.join(path.resolve(dataRoot), 'sites', normalizeSiteId(siteId));
}

export function configureDataStore({ agentRoot = null, dataDir = null, siteId } = {}) {
    const resolvedDataRoot = resolveDataDir(agentRoot, dataDir);
    const normalizedSiteId = normalizeSiteId(siteId);
    const resolvedDataDir = resolveSiteDataDir(resolvedDataRoot, normalizedSiteId);

    configuredDataRoot = resolvedDataRoot;
    configuredDataDir = resolvedDataDir;
    configuredSiteId = normalizedSiteId;
    dataStoreInstance = new MarkdownDataStore({ dataDir: resolvedDataDir });
    return dataStoreInstance;
}

export function getConfiguredDataRoot() {
    if (!configuredDataRoot) {
        throw new Error('Datastore is not configured. Call configureDataStore first.');
    }
    return configuredDataRoot;
}

export function getConfiguredDataDir() {
    if (!configuredDataDir) {
        throw new Error('Datastore is not configured. Call configureDataStore first.');
    }
    return configuredDataDir;
}

export function getConfiguredSiteId() {
    if (!configuredSiteId) {
        throw new Error('Datastore is not configured. Call configureDataStore first.');
    }
    return configuredSiteId;
}

export function getDataStore() {
    if (!dataStoreInstance) {
        throw new Error('Datastore is not configured. Call configureDataStore first.');
    }
    return dataStoreInstance;
}
