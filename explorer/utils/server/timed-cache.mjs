export function createTimedCache({ ttlMs, maxEntries = 100 } = {}) {
  const cache = new Map();

  const prune = () => {
    if (cache.size <= maxEntries) return;
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
  };

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
      prune();
    },
    clear() {
      cache.clear();
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

