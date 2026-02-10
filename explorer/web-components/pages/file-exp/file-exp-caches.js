const createTimedCache = ({ ttlMs }) => {
    const cache = new Map();
    return {
        get(key) {
            const entry = cache.get(key);
            if (!entry) return null;
            if ((Date.now() - entry.cachedAt) > ttlMs) {
                cache.delete(key);
                return null;
            }
            return entry.value;
        },
        set(key, value) {
            cache.set(key, { cachedAt: Date.now(), value });
        },
        delete(key) {
            cache.delete(key);
        },
        clear() {
            cache.clear();
        },
        keys() {
            return cache.keys();
        }
    };
};

export function createFileExpCaches({
    dirListingTtlMs = 5000,
    filePreviewTtlMs = 15000,
    mdTreeTtlMs = 15000
} = {}) {
    const dirListing = createTimedCache({ ttlMs: dirListingTtlMs });
    const filePreview = createTimedCache({ ttlMs: filePreviewTtlMs });
    const mdTree = createTimedCache({ ttlMs: mdTreeTtlMs });

    const normalizeDirPath = (normalizePathFn, dirPath) => normalizePathFn ? normalizePathFn(dirPath) : dirPath;

    return {
        dirListing: {
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
                dirListing.delete(normalized);
                mdTree.delete(normalized);
            },
            keys() {
                return Array.from(dirListing.keys());
            }
        },
        filePreview: {
            buildKey(filePath, entry, truncated) {
                const modified = entry?.modified || '';
                const size = Number.isFinite(entry?.size) ? entry.size : '';
                return `${filePath}|${modified}|${size}|${truncated ? 'partial' : 'full'}`;
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
            }
        },
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
