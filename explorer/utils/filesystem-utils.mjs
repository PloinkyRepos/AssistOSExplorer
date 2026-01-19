import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CACHE_CONFIG = {
  maxFileSizeBytes: 2 * 1024 * 1024, // 2MB
  maxFiles: 200,
  maxDirs: 200,
  ttlMs: Number.parseInt(process.env.FS_CACHE_TTL_MS || '5000', 10) // 5s
};

const pruneCache = (cache, limit) => {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
};

const isFreshFile = (entry, stats, ttlMs) => {
  if (!entry) return false;
  if ((Date.now() - entry.cachedAt) > ttlMs) return false;
  return entry.mtimeMs === stats.mtimeMs && entry.size === stats.size;
};

const isFreshDir = (entry, stats, ttlMs) => {
  if (!entry) return false;
  if ((Date.now() - entry.cachedAt) > ttlMs) return false;
  return entry.mtimeMs === stats.mtimeMs;
};

export function createCacheHelpers({ readFileContent, config } = {}) {
  if (typeof readFileContent !== 'function') {
    throw new Error('createCacheHelpers requires a readFileContent function');
  }

  const cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...(config || {}) };
  const fileCache = new Map();
  const dirCache = new Map();

  const invalidateCachesForPath = (targetPath) => {
    if (!targetPath) return;
    fileCache.delete(targetPath);
    dirCache.delete(targetPath);
    let current = path.dirname(targetPath);
    while (current && current !== path.dirname(current)) {
      dirCache.delete(current);
      current = path.dirname(current);
    }
  };

  const readFileWithCache = async (validPath, { skipReadForLarge = false } = {}) => {
    const stats = await fs.stat(validPath);
    const cached = fileCache.get(validPath);
    if (isFreshFile(cached, stats, cacheConfig.ttlMs)) {
      return { content: cached.content, stats };
    }

    if (stats.size > cacheConfig.maxFileSizeBytes && skipReadForLarge) {
      fileCache.delete(validPath);
      return { content: null, stats };
    }

    const content = await readFileContent(validPath);
    if (stats.size <= cacheConfig.maxFileSizeBytes) {
      fileCache.set(validPath, { content, mtimeMs: stats.mtimeMs, size: stats.size, cachedAt: Date.now() });
      pruneCache(fileCache, cacheConfig.maxFiles);
    } else {
      fileCache.delete(validPath);
    }
    return { content, stats };
  };

  const listDirectoryDetailedWithCache = async (validPath) => {
    const stats = await fs.stat(validPath);
    const cached = dirCache.get(validPath);
    if (isFreshDir(cached, stats, cacheConfig.ttlMs)) {
      return cached.entries;
    }

    const entries = await fs.readdir(validPath, { withFileTypes: true });
    const detailed = await Promise.all(entries.map(async entry => {
      const entryPath = path.join(validPath, entry.name);
      try {
        const entryStats = await fs.stat(entryPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          size: entryStats.size,
          modified: entryStats.mtime.toISOString()
        };
      } catch {
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          size: null,
          modified: null
        };
      }
    }));

    dirCache.set(validPath, { entries: detailed, mtimeMs: stats.mtimeMs, cachedAt: Date.now() });
    pruneCache(dirCache, cacheConfig.maxDirs);
    return detailed;
  };

  return {
    readFileWithCache,
    listDirectoryDetailedWithCache,
    invalidateCachesForPath,
    cacheConfig
  };
}

export const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const copyRecursive = async (sourcePath, destinationPath, overwrite = false) => {
  const stats = await fs.lstat(sourcePath);

  if (stats.isDirectory()) {
    if (await pathExists(destinationPath)) {
      if (!overwrite) {
        throw new Error(`Destination ${destinationPath} already exists.`);
      }
      await fs.rm(destinationPath, { recursive: true, force: true });
    }
    await fs.cp(sourcePath, destinationPath, { recursive: true, force: overwrite, errorOnExist: !overwrite });
    return;
  }

  if (!overwrite && await pathExists(destinationPath)) {
    throw new Error(`Destination ${destinationPath} already exists.`);
  }

  const destinationDir = path.dirname(destinationPath);
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
};
