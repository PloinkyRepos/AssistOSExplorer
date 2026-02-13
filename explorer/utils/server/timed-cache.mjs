export function createTimedCache({ ttlMs, maxEntries = 100 } = {}) {
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

  const prune = () => {
    if (cache.size <= maxEntries) return;
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
      stats.evictions += 1;
    }
  };

  return {
    get(key) {
      const entry = cache.get(key);
      if (!entry) {
        stats.misses += 1;
        return null;
      }
      if ((Date.now() - entry.cachedAt) > ttlMs) {
        cache.delete(key);
        stats.misses += 1;
        stats.staleMisses += 1;
        return null;
      }
      stats.hits += 1;
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
        ttlMs,
        maxEntries
      };
    }
  };
}

function normalizeCacheKeyPart(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(String).slice().sort().join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function buildCacheKey(prefix, parts) {
  const payload = Object.entries(parts || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${normalizeCacheKeyPart(value)}`)
    .join('|');
  return `${prefix}|${payload}`;
}
