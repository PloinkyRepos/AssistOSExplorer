export function createWorkspaceSearch({
  fs,
  path,
  readline,
  minimatch,
  workspaceRoot,
  validatePath,
  getAllowedDirectories,
  readFileWithCache,
  writeFileContent,
  cacheConfig,
  indexDirectory,
  structureIndex,
  dirIndexTtlMs,
  defaultExcludes,
  maxTextSearchFileBytes
}) {
  const MAX_PREVIEW_CHARS = 200;

  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const normalizeMatchPath = (relativePath) => (relativePath ? `/${relativePath}` : '/');

  const buildMatchId = (pathValue, line, column, matchIndex) => {
    const payload = JSON.stringify([pathValue, line, column, matchIndex]);
    return Buffer.from(payload, 'utf8').toString('base64');
  };

  const buildSearchRegex = (options) => {
    const rawQuery = String(options?.query ?? '');
    if (!rawQuery.trim()) {
      return null;
    }
    const useRegex = Boolean(options?.useRegex);
    const wholeWord = Boolean(options?.wholeWord);
    const caseSensitive = Boolean(options?.caseSensitive);
    let pattern = useRegex ? rawQuery : escapeRegExp(rawQuery);
    if (wholeWord) {
      pattern = `\\b(?:${pattern})\\b`;
    }
    const flags = caseSensitive ? 'g' : 'gi';
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid regex pattern: ${message}`);
    }
  };

  const findMatchesInLine = (line, regex) => {
    if (!regex) return [];
    regex.lastIndex = 0;
    const matches = [];
    let matchIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const matchText = match[0] ?? '';
      matches.push({
        index: Number.isFinite(match.index) ? match.index : 0,
        text: matchText,
        match,
        matchIndex
      });
      matchIndex += 1;
      if (matchText.length === 0) {
        if (regex.lastIndex === match.index) {
          regex.lastIndex += 1;
        }
      }
    }
    return matches;
  };

  const applyReplacementTemplate = (template, match, offset, input) => {
    const matchText = match[0] ?? '';
    const groups = match.slice(1);
    const namedGroups = match.groups || {};
    return String(template ?? '').replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (_full, token) => {
      if (token === '$') return '$';
      if (token === '&') return matchText;
      if (token === '`') return input.slice(0, offset);
      if (token === "'") return input.slice(offset + matchText.length);
      if (token.startsWith('<') && token.endsWith('>')) {
        const name = token.slice(1, -1);
        return namedGroups[name] ?? '';
      }
      const num = Number(token);
      if (!Number.isNaN(num)) {
        if (num === 0) return `$${token}`;
        return groups[num - 1] ?? '';
      }
      return `$${token}`;
    });
  };
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
    const maxResults = options.maxResults || 2000;
    const regex = buildSearchRegex(options);
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
            const matches = findMatchesInLine(line, regex);
            if (!matches.length) continue;
            const resultPath = normalizeMatchPath(relativePath);
            for (const match of matches) {
              const column = match.index + 1;
              results.push({
                path: resultPath,
                line: idx + 1,
                column,
                matchIndex: match.matchIndex,
                match: match.text,
                length: match.text.length,
                preview: line.trim().slice(0, MAX_PREVIEW_CHARS),
                id: buildMatchId(resultPath, idx + 1, column, match.matchIndex)
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
          const matches = findMatchesInLine(line, regex);
          if (!matches.length) continue;
          const resultPath = normalizeMatchPath(relativePath);
          for (const match of matches) {
            const column = match.index + 1;
            results.push({
              path: resultPath,
              line: lineNumber,
              column,
              matchIndex: match.matchIndex,
              match: match.text,
              length: match.text.length,
              preview: line.trim().slice(0, MAX_PREVIEW_CHARS),
              id: buildMatchId(resultPath, lineNumber, column, match.matchIndex)
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

  async function replaceTextWithinWorkspace(rootPath, options, config = {}) {
    const maxBytesPerFile = config.maxBytesPerFile || maxTextSearchFileBytes;
    const caseSensitive = Boolean(options.caseSensitive);
    const regex = buildSearchRegex(options);
    const shouldExclude = makeShouldExclude(options.excludePatterns, caseSensitive);
    const selectedMatchIds = Array.isArray(options.selectedMatchIds) ? options.selectedMatchIds : [];
    const selectedSet = new Set(selectedMatchIds);
    const hasSelection = selectedSet.size > 0;
    const remainingSelected = new Set(selectedMatchIds);
    const dryRun = Boolean(options.dryRun);

    const summary = {
      filesScanned: 0,
      filesMatched: 0,
      filesChanged: 0,
      totalMatches: 0,
      totalReplacements: 0,
      selectedMatches: hasSelection ? selectedSet.size : null,
      missingMatches: 0,
      skippedBinary: 0,
      skippedTooLarge: 0,
      skippedUnreadable: 0
    };
    const changedFiles = [];
    const changedFilesAbs = [];
    const errors = [];
    let stop = false;

    if (!regex) {
      return { summary, changedFiles, changedFilesAbs, errors, truncated: false };
    }

    if (!isPathWithinAllowedDirectories(rootPath)) {
      throw new Error('Access denied: path is outside allowed directories.');
    }

    const processFile = async (filePath, relativePath) => {
      summary.filesScanned += 1;
      try {
        const stats = await fs.stat(filePath);
        if (stats.size > maxBytesPerFile) {
          summary.skippedTooLarge += 1;
          return;
        }
        if (await isLikelyBinaryFile(filePath)) {
          summary.skippedBinary += 1;
          return;
        }
      } catch (error) {
        summary.skippedUnreadable += 1;
        errors.push({ path: normalizeMatchPath(relativePath), error: error instanceof Error ? error.message : String(error) });
        return;
      }

      let text;
      try {
        text = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        summary.skippedUnreadable += 1;
        errors.push({ path: normalizeMatchPath(relativePath), error: error instanceof Error ? error.message : String(error) });
        return;
      }

      const lineRegex = /[^\r\n]*\r?\n|[^\r\n]+$/g;
      let lineMatch;
      let lineNumber = 0;
      let fileMatchCount = 0;
      let fileReplacementCount = 0;
      let contentChanged = false;
      const output = [];

      while ((lineMatch = lineRegex.exec(text)) !== null) {
        if (stop) break;
        const rawLine = lineMatch[0];
        let lineText = rawLine;
        let lineBreak = '';
        if (rawLine.endsWith('\r\n')) {
          lineText = rawLine.slice(0, -2);
          lineBreak = '\r\n';
        } else if (rawLine.endsWith('\n')) {
          lineText = rawLine.slice(0, -1);
          lineBreak = '\n';
        }

        lineNumber += 1;
        const matches = findMatchesInLine(lineText, regex);
        if (!matches.length) {
          output.push(lineText + lineBreak);
          continue;
        }

        const resultPath = normalizeMatchPath(relativePath);
        let lastIndex = 0;
        let lineBuilder = '';
        let lineChanged = false;
        for (const match of matches) {
          const column = match.index + 1;
          const matchId = buildMatchId(resultPath, lineNumber, column, match.matchIndex);
          fileMatchCount += 1;
          summary.totalMatches += 1;

          const isSelected = !hasSelection || selectedSet.has(matchId);
          const matchText = match.text;
          const matchEnd = match.index + matchText.length;

          if (isSelected) {
            const replacement = options.useRegex
              ? applyReplacementTemplate(options.replaceWith, match.match, match.index, lineText)
              : String(options.replaceWith ?? '');
            lineBuilder += lineText.slice(lastIndex, match.index) + replacement;
            lastIndex = matchEnd;
            fileReplacementCount += 1;
            summary.totalReplacements += 1;
            if (replacement !== matchText) {
              lineChanged = true;
            }
            if (hasSelection) {
              remainingSelected.delete(matchId);
            }
          } else {
            lineBuilder += lineText.slice(lastIndex, matchEnd);
            lastIndex = matchEnd;
          }
        }
        lineBuilder += lineText.slice(lastIndex);
        output.push(lineBuilder + lineBreak);

        if (lineChanged) {
          contentChanged = true;
        }
      }

      if (fileMatchCount > 0) {
        summary.filesMatched += 1;
      }
      if (fileReplacementCount > 0 && contentChanged) {
        if (!dryRun) {
          const updatedContent = output.join('');
          if (updatedContent !== text) {
            try {
              await writeFileContent(filePath, updatedContent);
            } catch (error) {
              errors.push({ path: normalizeMatchPath(relativePath), error: error instanceof Error ? error.message : String(error) });
              return;
            }
          }
        }
        summary.filesChanged += 1;
        changedFiles.push(normalizeMatchPath(relativePath));
        changedFilesAbs.push(filePath);
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
          await processFile(fullPath, relativePath);
        }
        if (hasSelection && remainingSelected.size === 0) {
          stop = true;
          break;
        }
      }
    };

    await walk(rootPath);

    if (hasSelection) {
      summary.missingMatches = remainingSelected.size;
    }

    return {
      summary,
      changedFiles,
      changedFilesAbs,
      errors,
      truncated: false,
      dryRun
    };
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
    replaceTextWithinWorkspace,
    isPathWithinAllowedDirectories
  };
}
