export function createWorkspaceSearch({
  fs,
  path,
  readline,
  minimatch,
  workspaceRoot,
  validatePath,
  getAllowedDirectories,
  readFileWithCache,
  cacheConfig,
  indexDirectory,
  structureIndex,
  dirIndexTtlMs,
  defaultExcludes,
  maxTextSearchFileBytes
}) {
  function isPathWithinAllowedDirectories(targetPath) {
    const normalized = path.resolve(targetPath);
    const allowedDirectories = getAllowedDirectories();
    return allowedDirectories.some((dir) => normalized.startsWith(path.resolve(dir)));
  }

  async function isLikelyBinaryFile(filePath) {
    let handle;
    try {
      handle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const slice = buffer.subarray(0, bytesRead);
      return slice.includes(0);
    } catch {
      return false;
    } finally {
      if (handle) {
        await handle.close();
      }
    }
  }

  function makeShouldExclude(optionsExcludePatterns, caseSensitive) {
    const mergedExclude = [...defaultExcludes, ...(optionsExcludePatterns || [])];
    return (relativePath) => mergedExclude.some((patternItem) => {
      let glob = patternItem;
      if (!patternItem.includes('*')) {
        glob = patternItem.includes('.')
          ? `**/${patternItem}`
          : `**/${patternItem}/**`;
      }
      return minimatch(relativePath, glob, { dot: true, nocase: !caseSensitive });
    });
  }

  async function searchTextWithinWorkspace(rootPath, options, config = {}) {
    const maxBytesPerFile = config.maxBytesPerFile || maxTextSearchFileBytes;
    const caseSensitive = Boolean(options.caseSensitive);
    const normalizedQuery = caseSensitive ? options.query : options.query.toLowerCase();
    const maxResults = options.maxResults || 200;
    const results = [];
    let truncated = false;
    let stop = false;

    if (!isPathWithinAllowedDirectories(rootPath)) {
      throw new Error('Access denied: path is outside allowed directories.');
    }

    const shouldExclude = makeShouldExclude(options.excludePatterns, caseSensitive);

    const searchFileForQuery = async (filePath, relativePath) => {
      let handle;
      try {
        const stats = await fs.stat(filePath);
        if (stats.size > maxBytesPerFile) {
          return;
        }
        if (await isLikelyBinaryFile(filePath)) {
          return;
        }

        const canUseCache = stats.size <= cacheConfig.maxFileSizeBytes;
        if (canUseCache) {
          const { content } = await readFileWithCache(filePath);
          const text = typeof content === 'string' ? content : '';
          const lines = text.split(/\r?\n/);
          for (let idx = 0; idx < lines.length; idx++) {
            if (stop) break;
            const line = lines[idx];
            const haystack = caseSensitive ? line : line.toLowerCase();
            if (haystack.includes(normalizedQuery)) {
              results.push({
                path: relativePath ? `/${relativePath}` : '/',
                line: idx + 1,
                preview: line.trim().slice(0, 200)
              });
              if (results.length >= maxResults) {
                truncated = true;
                stop = true;
                break;
              }
            }
          }
          return;
        }

        handle = await fs.open(filePath, 'r');
        const stream = handle.createReadStream({ encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let lineNumber = 0;
        for await (const line of rl) {
          lineNumber++;
          const haystack = caseSensitive ? line : line.toLowerCase();
          if (haystack.includes(normalizedQuery)) {
            results.push({
              path: relativePath ? `/${relativePath}` : '/',
              line: lineNumber,
              preview: line.trim().slice(0, 200)
            });
            if (results.length >= maxResults) {
              truncated = true;
              stop = true;
              rl.close();
              stream.destroy();
              break;
            }
          }
          if (stop) {
            break;
          }
        }
      } catch {
        // swallow individual file errors to keep search running
      } finally {
        if (handle) {
          await handle.close();
        }
      }
    };

    const walk = async (currentPath) => {
      if (stop) return;
      let entries;
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (stop) break;
        const fullPath = path.join(currentPath, entry.name);
        try {
          await validatePath(fullPath);
        } catch {
          continue;
        }
        const relativePath = path.relative(workspaceRoot, fullPath);
        if (shouldExclude(relativePath || entry.name)) {
          continue;
        }
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          await searchFileForQuery(fullPath, relativePath);
        }
      }
    };

    await walk(rootPath);
    return { results, truncated };
  }

  async function searchFilesWithinWorkspace(rootPath, options) {
    const shouldExclude = makeShouldExclude(options.excludePatterns, false);
    const maxResults = options.maxResults || 5000;
    const pattern = String(options.pattern || '').trim();
    const results = [];
    let truncated = false;

    if (!isPathWithinAllowedDirectories(rootPath)) {
      throw new Error('Access denied: path is outside allowed directories.');
    }

    const hasGlobMeta = /[*?[\]]/.test(pattern);
    const normalizedNeedle = pattern.toLowerCase();

    const matches = (relativePath, name) => {
      if (!pattern) return false;
      if (hasGlobMeta) {
        return minimatch(relativePath, pattern, { dot: true, nocase: true }) || minimatch(name, pattern, { dot: true, nocase: true });
      }
      return String(name || '').toLowerCase().includes(normalizedNeedle);
    };

    const walkIndexed = async (currentPath) => {
      const normalizedCurrent = path.resolve(currentPath);
      const relativePath = path.relative(workspaceRoot, normalizedCurrent);
      if (shouldExclude(relativePath || path.basename(normalizedCurrent))) {
        return { ok: true };
      }

      const indexed = structureIndex.get(currentPath);
      if (!indexed) {
        return { ok: false };
      }
      if (typeof dirIndexTtlMs === 'number' && dirIndexTtlMs > 0) {
        if ((Date.now() - indexed.cachedAt) > dirIndexTtlMs) {
          return { ok: false };
        }
      }

      for (const entry of indexed.entries || []) {
        if (!entry?.name) continue;
        const childValid = path.join(currentPath, entry.name);
        const childRel = path.relative(workspaceRoot, childValid);
        if (shouldExclude(childRel || entry.name)) continue;
        if (matches(childRel, entry.name)) {
          results.push(childRel ? `/${childRel}` : '/');
          if (results.length >= maxResults) {
            truncated = true;
            return { ok: true, stop: true };
          }
        }
        if (entry.type === 'directory') {
          const nested = await walkIndexed(childValid);
          if (!nested.ok) return { ok: false };
          if (nested.stop) return { ok: true, stop: true };
        }
      }
      return { ok: true };
    };

    const rootIndexAttempt = await walkIndexed(rootPath);
    if (rootIndexAttempt.ok) {
      return { results, truncated };
    }

    async function walkFromDisk(currentPath) {
      const normalizedCurrent = path.resolve(currentPath);
      const rel = path.relative(workspaceRoot, normalizedCurrent);
      if (shouldExclude(rel || path.basename(normalizedCurrent))) {
        return;
      }

      const entries = await indexDirectory(currentPath);
      for (const entry of entries) {
        if (!entry?.name) continue;
        const childValid = path.join(currentPath, entry.name);
        const childRel = path.relative(workspaceRoot, childValid);
        if (shouldExclude(childRel || entry.name)) continue;
        if (matches(childRel, entry.name)) {
          results.push(childRel ? `/${childRel}` : '/');
          if (results.length >= maxResults) {
            truncated = true;
            return;
          }
        }
        if (entry.type === 'directory') {
          await walkFromDisk(childValid);
          if (truncated) return;
        }
      }
    }

    await walkFromDisk(rootPath);
    return { results, truncated };
  }

  return {
    searchTextWithinWorkspace,
    searchFilesWithinWorkspace,
    isPathWithinAllowedDirectories
  };
}
