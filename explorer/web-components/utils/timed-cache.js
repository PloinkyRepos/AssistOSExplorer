function toPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

export function createTimedCache({
    ttlMs = 5000,
    maxEntries = 200,
    refreshOnGet = true
} = {}) {
    const normalizedTtlMs = toPositiveInteger(ttlMs, 5000);
    const normalizedMaxEntries = toPositiveInteger(maxEntries, 200);
    const cache = new Map();
    const stats = {
        hits: 0,
        misses: 0,
        staleMisses: 0,
        sets: 0,
        deletes: 0,
        clears: 0,
        evictions: 0
    };

    const touch = (key, entry) => {
        cache.delete(key);
        cache.set(key, entry);
    };

    const evictOldest = () => {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) return;
        cache.delete(oldestKey);
        stats.evictions += 1;
    };

    const prune = () => {
        while (cache.size > normalizedMaxEntries) {
            evictOldest();
        }
    };

    return {
        get(key) {
            const entry = cache.get(key);
            if (!entry) {
                stats.misses += 1;
                return null;
            }
            if ((Date.now() - entry.cachedAt) > normalizedTtlMs) {
                cache.delete(key);
                stats.misses += 1;
                stats.staleMisses += 1;
                return null;
            }
            stats.hits += 1;
            if (refreshOnGet) {
                touch(key, entry);
            }
            return entry.value;
        },
        set(key, value) {
            stats.sets += 1;
            cache.set(key, { cachedAt: Date.now(), value });
            prune();
        },
        delete(key) {
            const removed = cache.delete(key);
            if (removed) {
                stats.deletes += 1;
            }
            return removed;
        },
        clear() {
            if (cache.size > 0) {
                stats.clears += 1;
            }
            cache.clear();
        },
        keys() {
            return cache.keys();
        },
        size() {
            return cache.size;
        },
        getStats() {
            return {
                ...stats,
                size: cache.size,
                ttlMs: normalizedTtlMs,
                maxEntries: normalizedMaxEntries
            };
        }
    };
}
