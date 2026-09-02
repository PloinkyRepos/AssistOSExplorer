import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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

function getConfiguredWebAssistDataRoot() {
    const configuredRoot = String(process.env.WEBASSIST_DATA_ROOT || '').trim();
    if (!configuredRoot) {
        throw new Error('WEBASSIST_DATA_ROOT is required to resolve the webAssist data directory.');
    }

    const dataRoot = path.resolve(configuredRoot);
    if (path.basename(dataRoot) !== 'data') {
        throw new Error('WEBASSIST_DATA_ROOT must name the application-owned data child.');
    }
    return dataRoot;
}

export async function initializeWebAssistDataRoot({ fsModule = fsPromises } = {}) {
    const dataRoot = getConfiguredWebAssistDataRoot();
    const persistentRoot = path.dirname(dataRoot);
    let persistentRootStats;
    try {
        persistentRootStats = await fsModule.lstat(persistentRoot);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(`webAssist persistent storage root does not exist: ${persistentRoot}`);
        }
        throw error;
    }
    if (persistentRootStats.isSymbolicLink() || !persistentRootStats.isDirectory()) {
        throw new Error(`webAssist persistent storage root must be a non-symlink directory: ${persistentRoot}`);
    }
    const canonicalPersistentRoot = await fsModule.realpath(persistentRoot);

    let dataRootStats = null;
    try {
        dataRootStats = await fsModule.lstat(dataRoot);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    if (dataRootStats?.isSymbolicLink()) {
        throw new Error(`webAssist data directory must not be a symbolic link: ${dataRoot}`);
    }
    if (!dataRootStats) {
        await fsModule.mkdir(dataRoot).catch((error) => {
            if (error?.code !== 'EEXIST') throw error;
        });
        dataRootStats = await fsModule.lstat(dataRoot);
    }
    if (!dataRootStats.isDirectory()) {
        throw new Error(`webAssist data directory is not a directory: ${dataRoot}`);
    }
    const canonicalDataRoot = await fsModule.realpath(dataRoot);
    if (canonicalDataRoot !== path.join(canonicalPersistentRoot, 'data')) {
        throw new Error(`webAssist data directory escapes its persistent storage root: ${dataRoot}`);
    }
    return dataRoot;
}

export function resolveWebAssistDataRoot({ allowMissing = false } = {}) {
    const dataRoot = getConfiguredWebAssistDataRoot();
    const persistentRoot = path.dirname(dataRoot);
    let persistentRootStats;
    let dataRootStats;
    try {
        persistentRootStats = fs.lstatSync(persistentRoot);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        throw new Error(`webAssist data directory does not exist: ${dataRoot}`);
    }
    if (persistentRootStats.isSymbolicLink() || !persistentRootStats.isDirectory()) {
        throw new Error(`webAssist persistent storage root must be a non-symlink directory: ${persistentRoot}`);
    }
    const canonicalPersistentRoot = fs.realpathSync(persistentRoot);
    try {
        dataRootStats = fs.lstatSync(dataRoot);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        if (allowMissing) return dataRoot;
        throw new Error(`webAssist data directory does not exist: ${dataRoot}`);
    }
    if (dataRootStats.isSymbolicLink() || !dataRootStats.isDirectory()) {
        throw new Error(`webAssist data directory must be a non-symlink directory: ${dataRoot}`);
    }
    const canonicalDataRoot = fs.realpathSync(dataRoot);
    if (canonicalDataRoot !== path.join(canonicalPersistentRoot, 'data')) {
        throw new Error(`webAssist data directory escapes its persistent storage root: ${dataRoot}`);
    }
    return dataRoot;
}

export function resolveSiteDataDir(siteId, options) {
    return path.join(resolveWebAssistDataRoot(options), 'sites', normalizeSiteId(siteId));
}

export function resolveSiteAkuDir(siteId) {
    return path.join(resolveSiteDataDir(siteId), '.aku');
}

export function resolveDataRoot() {
    return resolveWebAssistDataRoot();
}
