import { createReadStream } from 'node:fs';
import { jsonResponse, textResponse } from './responses.mjs';

function parseArgs(schema, args, name) {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid arguments for ${name}: ${parsed.error}`);
  }
  return parsed.data;
}

async function readFileAsBase64Stream(filePath) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
      const finalBuffer = Buffer.concat(chunks);
      resolve(finalBuffer.toString('base64'));
    });
    stream.on('error', reject);
  });
}

export function createToolHandlers({
  fs,
  path,
  schemas,
  validatePath,
  cacheConfig,
  readFileWithCache,
  listDirectoryDetailedWithCache,
  indexDirectory,
  invalidateCachesForPath,
  invalidateStructureIndexSubtree,
  formatSize,
  getFileStats,
  applyFileEdits,
  tailFile,
  headFile,
  writeFileContent,
  copyRecursive,
  aggregateIdePlugins,
  workspaceRoot,
  buildDirectoryTree,
  directoryTreeCache,
  buildCacheKey,
  searchFilesCache,
  searchTextCache,
  searchFilesWithinWorkspace,
  searchTextWithinWorkspace,
  replaceTextWithinWorkspace,
  MAX_TEXT_SEARCH_FILE_BYTES,
  SEARCH_TEXT_TIMEOUT_MS,
  REPLACE_TEXT_TIMEOUT_MS,
  DEFAULT_DIRECTORY_TREE_MAX_DEPTH,
  DEFAULT_DIRECTORY_TREE_MAX_NODES,
  getAllowedDirectories
}) {
  const {
    ReadTextFileArgsSchema,
    ReadMediaFileArgsSchema,
    ReadMultipleFilesArgsSchema,
    WriteFileArgsSchema,
    WriteBinaryFileArgsSchema,
    EditFileArgsSchema,
    CreateDirectoryArgsSchema,
    DeleteFileArgsSchema,
    DeleteDirectoryArgsSchema,
    ListDirectoryArgsSchema,
    ListDirectoryWithSizesArgsSchema,
    ListDirectoryDetailedArgsSchema,
    DirectoryTreeArgsSchema,
    MoveFileArgsSchema,
    CopyFileArgsSchema,
    SearchFilesArgsSchema,
    SearchTextArgsSchema,
    ReplaceTextArgsSchema,
    GetFileInfoArgsSchema,
    CollectIDEPluginsArgsSchema,
    GetPluginSettingsArgsSchema,
    SetPluginEnabledArgsSchema
  } = schemas;
  const inflightSearchFiles = new Map();
  const inflightSearchText = new Map();
  const pluginSettingsPath = path.join(workspaceRoot, '.ploinky', 'explorer-plugin-settings.json');

  async function readPluginSettings() {
    try {
      const raw = await fs.readFile(pluginSettingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { plugins: {} };
      }
      const plugins = parsed.plugins && typeof parsed.plugins === 'object' && !Array.isArray(parsed.plugins)
        ? parsed.plugins
        : {};
      return { plugins };
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return { plugins: {} };
      }
      console.warn(`[filesystem-http] Failed to read plugin settings ${pluginSettingsPath}:`, error instanceof Error ? error.message : String(error));
      return { plugins: {} };
    }
  }

  async function writePluginSettings(settings) {
    const dirPath = path.dirname(pluginSettingsPath);
    await fs.mkdir(dirPath, { recursive: true });
    const normalized = {
      plugins: settings?.plugins && typeof settings.plugins === 'object' && !Array.isArray(settings.plugins)
        ? settings.plugins
        : {}
    };
    await fs.writeFile(pluginSettingsPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    invalidateCachesForPath(pluginSettingsPath);
  }

  async function handleReadText(args) {
    const data = parseArgs(ReadTextFileArgsSchema, args, 'read_text_file');
    const validPath = await validatePath(data.path);
    if (data.head && data.tail) throw new Error('Cannot specify both head and tail parameters simultaneously');
    if (data.tail) {
      const { content, stats } = await readFileWithCache(validPath, { skipReadForLarge: true });
      if (content !== null && stats.size <= cacheConfig.maxFileSizeBytes) {
        const lines = content.split(/\r?\n/);
        const sliced = lines.slice(-data.tail).join('\n');
        return textResponse(sliced);
      }
      const tailContent = await tailFile(validPath, data.tail);
      return textResponse(tailContent);
    }
    if (data.head) {
      const { content, stats } = await readFileWithCache(validPath, { skipReadForLarge: true });
      if (content !== null && stats.size <= cacheConfig.maxFileSizeBytes) {
        const lines = content.split(/\r?\n/);
        const sliced = lines.slice(0, data.head).join('\n');
        return textResponse(sliced);
      }
      const headContent = await headFile(validPath, data.head);
      return textResponse(headContent);
    }
    const { content } = await readFileWithCache(validPath);
    return textResponse(content);
  }

  async function handleReadMedia(args) {
    const data = parseArgs(ReadMediaFileArgsSchema, args, 'read_media_file');
    const validPath = await validatePath(data.path);
    const extension = path.extname(validPath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.mjs': 'application/javascript',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      '.m4a': 'audio/mp4',
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.webm': 'video/webm',
      '.ogv': 'video/ogg',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska'
    };
    const mimeType = mimeTypes[extension] || 'application/octet-stream';
    const data64 = await readFileAsBase64Stream(validPath);
    const name = path.basename(validPath);
    if (mimeType.startsWith('image/')) {
      return { content: [{ type: 'image', data: data64, mimeType }] };
    }
    if (mimeType.startsWith('audio/')) {
      return { content: [{ type: 'audio', data: data64, mimeType }] };
    }
    const dataUrl = `data:${mimeType};base64,${data64}`;
    return {
      content: [{
        type: 'resource',
        resource: {
          uri: dataUrl,
          name,
          mimeType,
          text: dataUrl
        }
      }]
    };
  }

  async function handleReadMultiple(args) {
    const data = parseArgs(ReadMultipleFilesArgsSchema, args, 'read_multiple_files');
    const results = await Promise.all(data.paths.map(async (filePath) => {
      try {
        const validPath = await validatePath(filePath);
        const { content } = await readFileWithCache(validPath, { skipReadForLarge: true });
        if (content === null) {
          return `${filePath}: Error - File too large to cache for batch read`;
        }
        return `${filePath}:\n${content}\n`;
      } catch (error) {
        return `${filePath}: Error - ${error instanceof Error ? error.message : String(error)}`;
      }
    }));
    return textResponse(results.join('\n---\n'));
  }

  async function handleWriteFile(args) {
    const data = parseArgs(WriteFileArgsSchema, args, 'write_file');
    const validPath = await validatePath(data.path);
    await writeFileContent(validPath, data.content);
    invalidateCachesForPath(validPath);
    return textResponse(`Successfully wrote to ${data.path}`);
  }

  async function handleWriteBinaryFile(args) {
    const data = parseArgs(WriteBinaryFileArgsSchema, args, 'write_binary_file');
    const validPath = await validatePath(data.path);
    const dirName = path.dirname(validPath);
    await fs.mkdir(dirName, { recursive: true });
    const encoding = data.encoding ?? 'base64';
    const buffer = Buffer.from(data.content, encoding);
    await fs.writeFile(validPath, buffer);
    invalidateCachesForPath(validPath);
    return textResponse(`Successfully wrote binary data to ${data.path}`);
  }

  async function handleEditFile(args) {
    const data = parseArgs(EditFileArgsSchema, args, 'edit_file');
    const validPath = await validatePath(data.path);
    const result = await applyFileEdits(validPath, data.edits, data.dryRun);
    invalidateCachesForPath(validPath);
    return textResponse(result);
  }

  async function handleCreateDirectory(args) {
    const data = parseArgs(CreateDirectoryArgsSchema, args, 'create_directory');
    const validPath = await validatePath(data.path);
    await fs.mkdir(validPath, { recursive: true });
    invalidateCachesForPath(validPath);
    return textResponse(`Successfully created directory ${data.path}`);
  }

  async function handleDeleteFile(args) {
    const data = parseArgs(DeleteFileArgsSchema, args, 'delete_file');
    const validPath = await validatePath(data.path);
    await fs.unlink(validPath);
    invalidateCachesForPath(validPath);
    return textResponse(`Successfully deleted file ${data.path}`);
  }

  async function handleDeleteDirectory(args) {
    const data = parseArgs(DeleteDirectoryArgsSchema, args, 'delete_directory');
    const validPath = await validatePath(data.path);
    await fs.rm(validPath, { recursive: true, force: true });
    invalidateCachesForPath(validPath);
    return textResponse(`Successfully deleted directory ${data.path}`);
  }

  async function handleListDirectory(args) {
    const data = parseArgs(ListDirectoryArgsSchema, args, 'list_directory');
    const validPath = await validatePath(data.path);
    const detailed = await listDirectoryDetailedWithCache(validPath);
    const formatted = detailed.map(entry => `${entry.type === 'directory' ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n');
    return textResponse(formatted);
  }

  async function handleListDirectoryWithSizes(args) {
    const data = parseArgs(ListDirectoryWithSizesArgsSchema, args, 'list_directory_with_sizes');
    const validPath = await validatePath(data.path);
    const detailed = await indexDirectory(validPath);
    const enriched = detailed.map(entry => ({
      name: entry.name,
      isDirectory: entry.type === 'directory',
      size: entry.size || 0,
      mtime: entry.modified ? new Date(entry.modified) : new Date(0)
    }));
    const sorted = [...enriched].sort((a, b) => data.sortBy === 'size' ? b.size - a.size : a.name.localeCompare(b.name));
    const lines = sorted.map(entry => `${entry.isDirectory ? '[DIR]' : '[FILE]'} ${entry.name.padEnd(30)} ${entry.isDirectory ? '' : formatSize(entry.size).padStart(10)}`);
    const totalFiles = enriched.filter(e => !e.isDirectory).length;
    const totalDirs = enriched.filter(e => e.isDirectory).length;
    const totalSize = enriched.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0);
    const summary = ['', `Total: ${totalFiles} files, ${totalDirs} directories`, `Combined size: ${formatSize(totalSize)}`];
    return textResponse([...lines, ...summary].join('\n'));
  }

  async function handleListDirectoryDetailed(args) {
    const data = parseArgs(ListDirectoryDetailedArgsSchema, args, 'list_directory_detailed');
    const validPath = await validatePath(data.path);
    const detailed = await indexDirectory(validPath);
    const ordered = [...detailed].sort((a, b) => {
      const typeOrder = { directory: 0, file: 1, other: 2 };
      const diff = (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return jsonResponse(ordered);
  }

  async function handleDirectoryTree(args) {
    const data = parseArgs(DirectoryTreeArgsSchema, args, 'directory_tree');
    const validPath = await validatePath(data.path);
    const maxDepth = data.maxDepth ?? DEFAULT_DIRECTORY_TREE_MAX_DEPTH;
    const maxNodes = data.maxNodes ?? DEFAULT_DIRECTORY_TREE_MAX_NODES;

    const cacheKey = buildCacheKey('directory_tree', { path: validPath, maxDepth, maxNodes });
    const cached = directoryTreeCache.get(cacheKey);
    if (cached) {
      return textResponse(cached);
    }
    const treeData = await buildDirectoryTree({
      rootPath: validPath,
      indexDirectory,
      path,
      maxDepth,
      maxNodes
    });
    const text = JSON.stringify(treeData, null, 2);
    directoryTreeCache.set(cacheKey, text);
    return textResponse(text);
  }

  async function handleMoveFile(args) {
    const data = parseArgs(MoveFileArgsSchema, args, 'move_file');
    const validSource = await validatePath(data.source);
    const validDestination = await validatePath(data.destination);
    const sourceStat = await fs.lstat(validSource);
    await fs.rename(validSource, validDestination);
    if (sourceStat.isDirectory()) {
      invalidateStructureIndexSubtree(validSource);
      invalidateStructureIndexSubtree(validDestination);
    }
    invalidateCachesForPath(validSource);
    invalidateCachesForPath(validDestination);
    return textResponse(`Successfully moved ${data.source} to ${data.destination}`);
  }

  async function handleCopyFile(args) {
    const data = parseArgs(CopyFileArgsSchema, args, 'copy_file');
    const validSource = await validatePath(data.source);
    const validDestination = await validatePath(data.destination);
    if (validSource === validDestination) {
      throw new Error('Source and destination must be different.');
    }
    const sourceStat = await fs.lstat(validSource);
    if (sourceStat.isDirectory()) {
      const normalizedSource = path.resolve(validSource);
      const normalizedDestination = path.resolve(validDestination);
      if (normalizedDestination === normalizedSource || normalizedDestination.startsWith(`${normalizedSource}${path.sep}`)) {
        throw new Error('Cannot copy a directory into itself or one of its subdirectories.');
      }
    }
    const overwrite = Boolean(data.overwrite);
    await copyRecursive(validSource, validDestination, overwrite);
    invalidateStructureIndexSubtree(validDestination);
    invalidateCachesForPath(validDestination);
    return textResponse(`Successfully copied ${data.source} to ${data.destination}${overwrite ? ' (overwritten)' : ''}`);
  }

  async function handleSearchFiles(args) {
    const data = parseArgs(SearchFilesArgsSchema, args, 'search_files');
    const validPath = await validatePath(data.path);
    const cacheKey = buildCacheKey('search_files', {
      path: validPath,
      pattern: data.pattern,
      excludePatterns: data.excludePatterns,
      maxResults: data.maxResults,
      workspaceVersion: data.workspaceVersion
    });
    const cached = searchFilesCache.get(cacheKey);
    if (cached) {
      return jsonResponse(cached);
    }
    let pending = inflightSearchFiles.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const { results: relativeResults, truncated } = await searchFilesWithinWorkspace(validPath, data);
        const payload = { results: relativeResults, truncated: Boolean(truncated) };
        searchFilesCache.set(cacheKey, payload);
        return payload;
      })()
        .finally(() => {
          inflightSearchFiles.delete(cacheKey);
        });
      inflightSearchFiles.set(cacheKey, pending);
    }
    const payload = await pending;
    return jsonResponse(payload);
  }

  async function handleSearchText(args) {
    const data = parseArgs(SearchTextArgsSchema, args, 'search_text');
    const validPath = await validatePath(data.path);
    const scopedPaths = Array.isArray(data.paths)
      ? Array.from(new Set(data.paths.map((entry) => String(entry || '').trim()).filter(Boolean))).sort()
      : [];
    const cacheKey = buildCacheKey('search_text', {
      path: validPath,
      query: data.query,
      caseSensitive: data.caseSensitive,
      useRegex: data.useRegex,
      wholeWord: data.wholeWord,
      maxResults: data.maxResults,
      excludePatterns: data.excludePatterns,
      paths: scopedPaths,
      workspaceVersion: data.workspaceVersion
    });
    const cached = searchTextCache.get(cacheKey);
    if (cached) {
      return textResponse(cached);
    }
    let pending = inflightSearchText.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const searchArgs = scopedPaths.length > 0
          ? { ...data, paths: scopedPaths }
          : data;
        const { results, truncated, timedOut } = await searchTextWithinWorkspace(validPath, searchArgs, {
          maxBytesPerFile: MAX_TEXT_SEARCH_FILE_BYTES,
          timeoutMs: SEARCH_TEXT_TIMEOUT_MS
        });
        const payload = { results, truncated, timedOut: Boolean(timedOut) };
        const text = JSON.stringify(payload);
        searchTextCache.set(cacheKey, text);
        return text;
      })()
        .finally(() => {
          inflightSearchText.delete(cacheKey);
        });
      inflightSearchText.set(cacheKey, pending);
    }
    const text = await pending;
    return textResponse(text);
  }

  async function handleReplaceText(args) {
    const data = parseArgs(ReplaceTextArgsSchema, args, 'replace_text');
    const validPath = await validatePath(data.path);
    const result = await replaceTextWithinWorkspace(validPath, data, {
      maxBytesPerFile: MAX_TEXT_SEARCH_FILE_BYTES,
      timeoutMs: REPLACE_TEXT_TIMEOUT_MS
    });
    if (Array.isArray(result.changedFilesAbs)) {
      result.changedFilesAbs.forEach((filePath) => invalidateCachesForPath(filePath));
    }
    const { changedFilesAbs, ...payload } = result;
    return jsonResponse(payload);
  }

  async function handleGetFileInfo(args) {
    const data = parseArgs(GetFileInfoArgsSchema, args, 'get_file_info');
    const validPath = await validatePath(data.path);
    const info = await getFileStats(validPath);
    const text = Object.entries(info).map(([key, value]) => `${key}: ${value}`).join('\n');
    return textResponse(text);
  }

  async function handleCollectIdePlugins(args) {
    parseArgs(CollectIDEPluginsArgsSchema, args, 'collect_ide_plugins');
    const pluginsByLocation = await aggregateIdePlugins(workspaceRoot);
    return jsonResponse(pluginsByLocation);
  }

  async function handleGetPluginSettings(args) {
    parseArgs(GetPluginSettingsArgsSchema, args, 'get_plugin_settings');
    const settings = await readPluginSettings();
    return jsonResponse(settings);
  }

  async function handleSetPluginEnabled(args) {
    const data = parseArgs(SetPluginEnabledArgsSchema, args, 'set_plugin_enabled');
    const settings = await readPluginSettings();
    const nextPlugins = {
      ...(settings.plugins || {}),
      [data.key]: {
        enabled: data.enabled
      }
    };
    const nextSettings = { plugins: nextPlugins };
    await writePluginSettings(nextSettings);
    return jsonResponse({
      ok: true,
      key: data.key,
      enabled: data.enabled,
      settings: nextSettings
    });
  }

  async function handleListAllowedDirectories() {
    const allowed = getAllowedDirectories ? getAllowedDirectories() : [];
    return textResponse(`Allowed directories:\n${allowed.join('\n')}`);
  }

  return {
    read_file: handleReadText,
    read_text_file: handleReadText,
    read_media_file: handleReadMedia,
    read_multiple_files: handleReadMultiple,
    write_file: handleWriteFile,
    write_binary_file: handleWriteBinaryFile,
    edit_file: handleEditFile,
    create_directory: handleCreateDirectory,
    delete_file: handleDeleteFile,
    delete_directory: handleDeleteDirectory,
    list_directory: handleListDirectory,
    list_directory_with_sizes: handleListDirectoryWithSizes,
    list_directory_detailed: handleListDirectoryDetailed,
    directory_tree: handleDirectoryTree,
    move_file: handleMoveFile,
    copy_file: handleCopyFile,
    search_files: handleSearchFiles,
    search_text: handleSearchText,
    replace_text: handleReplaceText,
    get_file_info: handleGetFileInfo,
    collect_ide_plugins: handleCollectIdePlugins,
    get_plugin_settings: handleGetPluginSettings,
    set_plugin_enabled: handleSetPluginEnabled,
    list_allowed_directories: handleListAllowedDirectories
  };
}
