import { createTimedCache } from "../../utils/timed-cache.js";

export function createFileExpCaches({
    dirListingTtlMs = 5000,
    filePreviewTtlMs = 15000,
    mdTreeTtlMs = 15000,
    dirListingMaxEntries = 300,
    filePreviewMaxEntries = 300,
    mdTreeMaxEntries = 150
} = {}) {
    const dirListing = createTimedCache({
        ttlMs: dirListingTtlMs,
        maxEntries: dirListingMaxEntries,
        refreshOnGet: true
    });
    const filePreview = createTimedCache({
        ttlMs: filePreviewTtlMs,
        maxEntries: filePreviewMaxEntries,
        refreshOnGet: true
    });
    const mdTree = createTimedCache({
        ttlMs: mdTreeTtlMs,
        maxEntries: mdTreeMaxEntries,
        refreshOnGet: true
    });

    const normalizeDirPath = (normalizePathFn, dirPath) => normalizePathFn ? normalizePathFn(dirPath) : dirPath;
    const dirListingGenerations = new Map();
    const getDirListingGeneration = (normalizedPath) => dirListingGenerations.get(normalizedPath) || 0;

    // Single-slot store for the active OnlyOffice session (managed by
    // services/onlyoffice/onlyoffice-preview-service.js). Lives here so the
    // filePreview invalidation lifecycle clears it whenever file content is
    // known to have changed.
    let officeSessionEntry = null;
    const officeSession = {
        get() {
            return officeSessionEntry;
        },
        set(entry) {
            officeSessionEntry = entry && typeof entry === 'object' ? entry : null;
        },
        clear() {
            officeSessionEntry = null;
        },
        invalidateForPath(filePath) {
            if (!filePath) return;
            if (officeSessionEntry?.path === filePath) {
                officeSessionEntry = null;
            }
        }
    };

    return {
        dirListing: {
            getGeneration(fileExp, dirPath) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                return getDirListingGeneration(normalized);
            },
            read(fileExp, dirPath) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                const cached = dirListing.peek(normalized, { allowStale: true });
                if (!cached || cached.isStale) return cached;
                return {
                    ...cached,
                    value: dirListing.get(normalized)
                };
            },
            get(fileExp, dirPath) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                return dirListing.get(normalized);
            },
            set(fileExp, dirPath, entries) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                dirListing.set(normalized, entries);
            },
            invalidate(fileExp, dirPath) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                dirListingGenerations.set(normalized, getDirListingGeneration(normalized) + 1);
                dirListing.delete(normalized);
                mdTree.delete(normalized);
            },
            keys() {
                return Array.from(dirListing.keys());
            }
        },
        filePreview: {
            buildKey(filePath, entry, truncated, workspaceVersion = 0) {
                const modified = entry?.modified || '';
                const size = Number.isFinite(entry?.size) ? entry.size : '';
                const version = Number.isFinite(workspaceVersion) ? workspaceVersion : 0;
                return `${filePath}|${modified}|${size}|${truncated ? 'partial' : 'full'}|v:${version}`;
            },
            get(cacheKey) {
                return filePreview.get(cacheKey);
            },
            set(cacheKey, value) {
                filePreview.set(cacheKey, value);
            },
            invalidateForPath(filePath) {
                if (!filePath) return;
                for (const key of filePreview.keys()) {
                    if (key.startsWith(`${filePath}|`)) {
                        filePreview.delete(key);
                    }
                }
                officeSession.invalidateForPath(filePath);
            }
        },
        officeSession,
        mdTree: {
            get(fileExp, dirPath) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                return mdTree.get(normalized);
            },
            set(fileExp, dirPath, value) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                mdTree.set(normalized, value);
            },
            invalidate(fileExp, dirPath) {
                const normalized = normalizeDirPath(fileExp?.normalizePath, dirPath);
                mdTree.delete(normalized);
            }
        }
    };
}
