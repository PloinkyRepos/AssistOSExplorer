export function normalizeRepoRelativePrefix(prefix) {
    const normalized = String(prefix || '').replace(/^\/+/, '');
    if (!normalized) return '';
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

export function createSelectionEntry() {
    return { files: new Set(), prefixes: new Set(), sectionsByFile: new Map() };
}

export function peekSelectionEntry(selectedFilesByRepo, repoPath) {
    if (!repoPath) return null;
    return selectedFilesByRepo?.[repoPath] || null;
}

export function ensureSelectionEntry(selectedFilesByRepo, repoPath) {
    if (!repoPath) return null;
    const store = selectedFilesByRepo || {};
    if (!store[repoPath]) {
        store[repoPath] = createSelectionEntry();
    } else {
        if (!store[repoPath].files) store[repoPath].files = new Set();
        if (!store[repoPath].prefixes) store[repoPath].prefixes = new Set();
        if (!store[repoPath].sectionsByFile) store[repoPath].sectionsByFile = new Map();
    }
    return store[repoPath];
}

export function getCoveringPrefix(entry, relativePath) {
    if (!entry?.prefixes) return null;
    const rel = String(relativePath || '');
    for (const prefix of entry.prefixes.values()) {
        if (prefix && rel.startsWith(prefix)) return prefix;
    }
    return null;
}

export function getAncestorCoveringPrefix(entry, prefix) {
    const normalizedPrefix = normalizeRepoRelativePrefix(prefix);
    if (!normalizedPrefix) return null;
    if (!entry?.prefixes) return null;
    for (const candidate of entry.prefixes.values()) {
        if (!candidate) continue;
        if (candidate !== normalizedPrefix && normalizedPrefix.startsWith(candidate)) return candidate;
    }
    return null;
}

export function isPathSelected(entry, relativePath) {
    if (!entry) return false;
    const rel = String(relativePath || '');
    if (entry.files?.has?.(rel)) return true;
    return Boolean(getCoveringPrefix(entry, rel));
}

export function toggleFileSelection(entry, filePath, section, isSelected) {
    if (!entry || !filePath) return;
    if (!isSelected && getCoveringPrefix(entry, filePath)) return;
    if (isSelected) {
        entry.files.add(filePath);
        if (section) entry.sectionsByFile.set(filePath, section);
    } else {
        entry.files.delete(filePath);
        entry.sectionsByFile.delete(filePath);
    }
}

export function togglePrefixSelection(entry, prefix, isSelected) {
    if (!entry) return;
    const normalizedPrefix = normalizeRepoRelativePrefix(prefix);
    if (!normalizedPrefix) return;
    if (getAncestorCoveringPrefix(entry, normalizedPrefix)) return;

    const clearSubtree = () => {
        for (const filePath of Array.from(entry.files || [])) {
            if (String(filePath).startsWith(normalizedPrefix)) {
                entry.files.delete(filePath);
                entry.sectionsByFile.delete(filePath);
            }
        }
        for (const candidate of Array.from(entry.prefixes || [])) {
            if (candidate !== normalizedPrefix && String(candidate).startsWith(normalizedPrefix)) {
                entry.prefixes.delete(candidate);
            }
        }
    };

    if (isSelected) {
        clearSubtree();
        entry.prefixes.add(normalizedPrefix);
    } else {
        entry.prefixes.delete(normalizedPrefix);
        clearSubtree();
    }
}

