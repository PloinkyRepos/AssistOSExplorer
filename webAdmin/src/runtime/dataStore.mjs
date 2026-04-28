import path from 'node:path';

import { MarkdownDataStore } from 'achillesAgentLib';

let configuredDataDir = null;
let dataStoreInstance = null;

export function resolveDataDir(agentRoot, explicitDataDir = null) {
    return explicitDataDir
        ? path.resolve(explicitDataDir)
        : path.resolve(agentRoot, '..', 'data');
}

export function configureDataStore({ agentRoot, dataDir = null } = {}) {
    if (!agentRoot) {
        throw new Error('configureDataStore requires agentRoot.');
    }

    const resolvedDataDir = resolveDataDir(agentRoot, dataDir);
    configuredDataDir = resolvedDataDir;
    dataStoreInstance = new MarkdownDataStore({ dataDir: resolvedDataDir });
    return dataStoreInstance;
}

export function getConfiguredDataDir() {
    if (!configuredDataDir) {
        throw new Error('Datastore is not configured. Call configureDataStore first.');
    }
    return configuredDataDir;
}

export function getDataStore() {
    if (!dataStoreInstance) {
        throw new Error('Datastore is not configured. Call configureDataStore first.');
    }
    return dataStoreInstance;
}
