function normalizeCandidate(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'directory') {
        return 'folder';
    }
    if (normalized === 'file' || normalized === 'folder') {
        return normalized;
    }
    return '';
}

export function normalizeDpuObjectType(value, fallback = '') {
    return normalizeCandidate(value) || normalizeCandidate(fallback) || '';
}

export function isDpuFileType(value, fallback = '') {
    return normalizeDpuObjectType(value, fallback) === 'file';
}

export function isDpuFolderType(value, fallback = '') {
    return normalizeDpuObjectType(value, fallback) === 'folder';
}

export function toExplorerEntryType(value, fallback = 'other') {
    const normalized = normalizeDpuObjectType(value);
    if (normalized === 'folder') {
        return 'directory';
    }
    if (normalized === 'file') {
        return 'file';
    }
    return fallback;
}
