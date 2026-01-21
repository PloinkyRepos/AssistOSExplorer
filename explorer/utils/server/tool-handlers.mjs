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
  gitService,
  MAX_TEXT_SEARCH_FILE_BYTES,
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
    GetFileInfoArgsSchema,
    CollectIDEPluginsArgsSchema,
    GitInfoArgsSchema,
    GitStatusArgsSchema,
    GitDiffArgsSchema,
    GitStageArgsSchema,
    GitUnstageArgsSchema,
    GitUntrackArgsSchema,
    GitCheckIgnoreArgsSchema,
    GitRestoreArgsSchema,
    GitConflictVersionsArgsSchema,
    GitCheckoutConflictArgsSchema,
    GitStashArgsSchema,
    GitStashListArgsSchema,
    GitStashPopArgsSchema,
    GitCommitArgsSchema,
    GitPushArgsSchema,
    GitPullArgsSchema,
    GitDiagnoseArgsSchema,
    GitReposOverviewArgsSchema,
    GitIdentityArgsSchema,
    GitSetIdentityArgsSchema
  } = schemas;

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
      maxResults: data.maxResults
    });
    const cached = searchFilesCache.get(cacheKey);
    if (cached) {
      return textResponse(cached);
    }
    const { results: relativeResults } = await searchFilesWithinWorkspace(validPath, data);
    const text = relativeResults.length > 0 ? relativeResults.join('\n') : 'No matches found';
    searchFilesCache.set(cacheKey, text);
    return textResponse(text);
  }

  async function handleSearchText(args) {
    const data = parseArgs(SearchTextArgsSchema, args, 'search_text');
    const validPath = await validatePath(data.path);
    const cacheKey = buildCacheKey('search_text', {
      path: validPath,
      query: data.query,
      caseSensitive: data.caseSensitive,
      maxResults: data.maxResults,
      excludePatterns: data.excludePatterns
    });
    const cached = searchTextCache.get(cacheKey);
    if (cached) {
      return textResponse(cached);
    }
    const { results, truncated } = await searchTextWithinWorkspace(validPath, data, { maxBytesPerFile: MAX_TEXT_SEARCH_FILE_BYTES });
    const payload = { results, truncated };
    const text = JSON.stringify(payload);
    searchTextCache.set(cacheKey, text);
    return textResponse(text);
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

  async function handleGitInfo(args) {
    const data = parseArgs(GitInfoArgsSchema, args, 'git_info');
    const info = await gitService.gitInfo(data);
    return jsonResponse(info);
  }

  async function handleGitStatus(args) {
    const data = parseArgs(GitStatusArgsSchema, args, 'git_status');
    const status = await gitService.gitStatus(data);
    return jsonResponse(status);
  }

  async function handleGitDiff(args) {
    const data = parseArgs(GitDiffArgsSchema, args, 'git_diff');
    const diff = await gitService.gitDiff(data);
    return textResponse(diff || '');
  }

  async function handleGitStage(args) {
    const data = parseArgs(GitStageArgsSchema, args, 'git_stage');
    const result = await gitService.gitStage(data);
    return jsonResponse(result);
  }

  async function handleGitUnstage(args) {
    const data = parseArgs(GitUnstageArgsSchema, args, 'git_unstage');
    const result = await gitService.gitUnstage(data);
    return jsonResponse(result);
  }

  async function handleGitUntrack(args) {
    const data = parseArgs(GitUntrackArgsSchema, args, 'git_untrack');
    const result = await gitService.gitUntrack(data);
    return jsonResponse(result);
  }

  async function handleGitCheckIgnore(args) {
    const data = parseArgs(GitCheckIgnoreArgsSchema, args, 'git_check_ignore');
    const result = await gitService.gitCheckIgnore(data);
    return jsonResponse(result);
  }

  async function handleGitRestore(args) {
    const data = parseArgs(GitRestoreArgsSchema, args, 'git_restore');
    const result = await gitService.gitRestore(data);
    return jsonResponse(result);
  }

  async function handleGitConflictVersions(args) {
    const data = parseArgs(GitConflictVersionsArgsSchema, args, 'git_conflict_versions');
    const result = await gitService.gitConflictVersions(data);
    return jsonResponse(result);
  }

  async function handleGitCheckoutConflict(args) {
    const data = parseArgs(GitCheckoutConflictArgsSchema, args, 'git_checkout_conflict');
    const result = await gitService.gitCheckoutConflict(data);
    return jsonResponse(result);
  }

  async function handleGitStash(args) {
    const data = parseArgs(GitStashArgsSchema, args, 'git_stash');
    const result = await gitService.gitStash(data);
    return jsonResponse(result);
  }

  async function handleGitStashList(args) {
    const data = parseArgs(GitStashListArgsSchema, args, 'git_stash_list');
    const result = await gitService.gitStashList(data);
    return jsonResponse(result);
  }

  async function handleGitStashPop(args) {
    const data = parseArgs(GitStashPopArgsSchema, args, 'git_stash_pop');
    const result = await gitService.gitStashPop(data);
    return jsonResponse(result);
  }

  async function handleGitCommit(args) {
    const data = parseArgs(GitCommitArgsSchema, args, 'git_commit');
    const result = await gitService.gitCommit(data);
    return jsonResponse(result);
  }

  async function handleGitPush(args) {
    const data = parseArgs(GitPushArgsSchema, args, 'git_push');
    const result = await gitService.gitPush(data);
    return jsonResponse(result);
  }

  async function handleGitPull(args) {
    const data = parseArgs(GitPullArgsSchema, args, 'git_pull');
    const result = await gitService.gitPull(data);
    return jsonResponse(result);
  }

  async function handleGitDiagnose(args) {
    const data = parseArgs(GitDiagnoseArgsSchema, args, 'git_diagnose');
    const result = await gitService.gitDiagnose(data);
    return jsonResponse(result);
  }

  async function handleGitReposOverview(args) {
    const data = parseArgs(GitReposOverviewArgsSchema, args, 'git_repos_overview');
    const result = await gitService.gitReposOverview(data);
    return jsonResponse(result);
  }

  async function handleGitIdentity(args) {
    const data = parseArgs(GitIdentityArgsSchema, args, 'git_identity');
    const result = await gitService.gitIdentity(data);
    return jsonResponse(result);
  }

  async function handleGitSetIdentity(args) {
    const data = parseArgs(GitSetIdentityArgsSchema, args, 'git_set_identity');
    const result = await gitService.gitSetIdentity(data);
    return jsonResponse(result);
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
    get_file_info: handleGetFileInfo,
    collect_ide_plugins: handleCollectIdePlugins,
    git_info: handleGitInfo,
    git_status: handleGitStatus,
    git_diff: handleGitDiff,
    git_stage: handleGitStage,
    git_unstage: handleGitUnstage,
    git_untrack: handleGitUntrack,
    git_check_ignore: handleGitCheckIgnore,
    git_restore: handleGitRestore,
    git_conflict_versions: handleGitConflictVersions,
    git_checkout_conflict: handleGitCheckoutConflict,
    git_stash: handleGitStash,
    git_stash_list: handleGitStashList,
    git_stash_pop: handleGitStashPop,
    git_commit: handleGitCommit,
    git_push: handleGitPush,
    git_pull: handleGitPull,
    git_diagnose: handleGitDiagnose,
    git_repos_overview: handleGitReposOverview,
    git_identity: handleGitIdentity,
    git_set_identity: handleGitSetIdentity,
    list_allowed_directories: handleListAllowedDirectories
  };
}
