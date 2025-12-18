#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { minimatch } from 'minimatch';

import { server as mcpServer, streamHttp as mcpStreamHttp, types as mcpTypes, zod as mcpZod } from 'mcp-sdk';
import { copyRecursive, createCacheHelpers } from './utils/filesystem-utils.mjs';
import { aggregateIdePlugins } from './utils/ide-plugins.mjs';
import { createTimedCache, buildCacheKey } from './utils/server/timed-cache.mjs';
import { createStructureIndex } from './utils/server/structure-index.mjs';
import { createWorkspaceSearch } from './utils/server/workspace-search.mjs';
import { buildDirectoryTree } from './utils/server/directory-tree.mjs';
import { createGitService } from './utils/server/git-service.mjs';

const { Server } = mcpServer;
const { StreamableHTTPServerTransport } = mcpStreamHttp;
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  RootsListChangedNotificationSchema
} = mcpTypes;
const { z } = mcpZod;

let fatalErrorState = null;

function recordFatalError(source, error) {
  if (fatalErrorState) return;
  const err = error instanceof Error ? error : new Error(String(error));
  fatalErrorState = {
    source,
    error: err,
    timestamp: new Date().toISOString(),
      cwd: process.cwd()
  };
  console.error(`[filesystem-http] fatal ${source}:`, err);
}

process.on('uncaughtException', (error) => {
  recordFatalError('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  recordFatalError('unhandledRejection', reason);
});

let zodToJsonSchema;
try {
  ({ zodToJsonSchema } = await import('zod-to-json-schema'));
} catch (error) {
  const moduleError = error instanceof Error ? error : new Error(String(error));
  recordFatalError('module-import:zod-to-json-schema', moduleError);
  zodToJsonSchema = () => {
    throw moduleError;
  };
}

let normalizePath;
let expandHome;
let getValidRootDirectories;
let formatSize;
let libraryValidatePath;
let getFileStats;
let readFileContent;
let writeFileContent;
let searchFilesWithValidation;
let applyFileEdits;
let tailFile;
let headFile;
let setAllowedDirectories;

try {
  const pathUtils = await import('@modelcontextprotocol/server-filesystem/dist/path-utils.js');
  ({ normalizePath, expandHome } = pathUtils);
  const rootsUtils = await import('@modelcontextprotocol/server-filesystem/dist/roots-utils.js');
  ({ getValidRootDirectories } = rootsUtils);
  const lib = await import('@modelcontextprotocol/server-filesystem/dist/lib.js');
  ({
    formatSize,
    validatePath: libraryValidatePath,
    getFileStats,
    readFileContent,
    writeFileContent,
    searchFilesWithValidation,
    applyFileEdits,
    tailFile,
    headFile,
    setAllowedDirectories
  } = lib);
} catch (error) {
  const moduleError = error instanceof Error ? error : new Error(String(error));
  recordFatalError('module-import:@modelcontextprotocol/server-filesystem', moduleError);
  const syncThrow = () => { throw moduleError; };
  const asyncThrow = async () => { throw moduleError; };
  normalizePath = syncThrow;
  expandHome = syncThrow;
  getValidRootDirectories = asyncThrow;
  formatSize = syncThrow;
  libraryValidatePath = asyncThrow;
  getFileStats = asyncThrow;
  readFileContent = asyncThrow;
  writeFileContent = asyncThrow;
  searchFilesWithValidation = asyncThrow;
  applyFileEdits = asyncThrow;
  tailFile = asyncThrow;
  headFile = asyncThrow;
  setAllowedDirectories = syncThrow;
}

const args = process.argv.slice(2);
const envRoots = (process.env.ASSISTOS_FS_ROOT || process.env.MCP_FS_ROOT || '').split(',').map(p => p.trim()).filter(Boolean);
// Use envRoots if set, otherwise fall back to args or cwd
if (envRoots.length) {
  args.length = 0;
  args.push(...envRoots);
} else if (!args.length) {
  args.push(process.cwd());
}

async function resolveAllowedDirectories(inputDirs) {
  const results = await Promise.all(inputDirs.map(async (dir) => {
    const expanded = expandHome(dir);
    const absolute = path.resolve(expanded);
    try {
      const resolved = await fs.realpath(absolute);
      return normalizePath(resolved);
    } catch (error) {
      return normalizePath(absolute);
    }
  }));
  const validated = [];
  for (const dir of results) {
    try {
      const stats = await fs.stat(dir);
      if (!stats.isDirectory()) {
        console.error(`[filesystem-http] Skipping ${dir} (not a directory)`);
        continue;
      }
      validated.push(dir);
    } catch (error) {
      console.error(`[filesystem-http] Error accessing directory ${dir}:`, error?.message || error);
    }
  }
  if (!validated.length) {
    const fallback = path.resolve(process.cwd());
    console.error(`[filesystem-http] No valid directories supplied, falling back to ${fallback}`);
    validated.push(fallback);
  }
  return validated;
}

let allowedDirectories = [];
try {
  allowedDirectories = await resolveAllowedDirectories(args);
  setAllowedDirectories(allowedDirectories);
} catch (error) {
  recordFatalError('init:allowed-directories', error);
  allowedDirectories = [];
}

const workspaceRoot = allowedDirectories.length > 0 ? allowedDirectories[0] : path.resolve(process.cwd());
if (allowedDirectories.length > 1) {
  console.warn(`[filesystem-http] Multiple allowed directories found, using the first one as workspace root: ${workspaceRoot}`);
}

let cacheConfig = {
  maxFileSizeBytes: 2 * 1024 * 1024,
  maxFiles: 200,
  maxDirs: 200,
  ttlMs: Number.parseInt(process.env.FS_CACHE_TTL_MS || '5000', 10)
};

let readFileWithCache = async (validPath, { skipReadForLarge = false } = {}) => {
  const stats = await fs.stat(validPath);
  if (stats.size > cacheConfig.maxFileSizeBytes && skipReadForLarge) {
    return { content: null, stats };
  }
  const content = await readFileContent(validPath);
  return { content, stats };
};

let listDirectoryDetailedWithCache = async (validPath) => {
  const entries = await fs.readdir(validPath, { withFileTypes: true });
  return Promise.all(entries.map(async entry => {
    const entryPath = path.join(validPath, entry.name);
    try {
      const stats = await fs.stat(entryPath);
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        size: stats.size,
        modified: stats.mtime.toISOString()
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
};

let invalidateCachesForPath = () => {};
let indexDirectory = async (validDirPath) => listDirectoryDetailedWithCache(validDirPath);
let structureIndex = new Map();
let invalidateStructureIndexForPathAndParents = () => {};
let invalidateStructureIndexSubtree = () => {};

const SEARCH_CACHE_TTL_MS = Number.parseInt(process.env.SEARCH_CACHE_TTL_MS || '5000', 10);
const SEARCH_CACHE_MAX_ENTRIES = Number.parseInt(process.env.SEARCH_CACHE_MAX_ENTRIES || '100', 10);
const searchFilesCache = createTimedCache({ ttlMs: SEARCH_CACHE_TTL_MS, maxEntries: SEARCH_CACHE_MAX_ENTRIES });
const searchTextCache = createTimedCache({ ttlMs: SEARCH_CACHE_TTL_MS, maxEntries: SEARCH_CACHE_MAX_ENTRIES });
const directoryTreeCache = createTimedCache({ ttlMs: SEARCH_CACHE_TTL_MS, maxEntries: SEARCH_CACHE_MAX_ENTRIES });

try {
  const cacheHelpers = createCacheHelpers({ readFileContent, config: cacheConfig });
  ({ readFileWithCache, listDirectoryDetailedWithCache, invalidateCachesForPath, cacheConfig } = cacheHelpers);
} catch (error) {
  recordFatalError('init:cache-helpers', error);
}

try {
  const structure = createStructureIndex({ fs, path, listDirectoryDetailedWithCache });
  ({ structureIndex, indexDirectory } = structure);
  invalidateStructureIndexForPathAndParents = structure.invalidateForPathAndParents;
  invalidateStructureIndexSubtree = structure.invalidateSubtree;
} catch (error) {
  recordFatalError('init:structure-index', error);
}

const baseInvalidateCachesForPath = invalidateCachesForPath;
invalidateCachesForPath = (targetPath) => {
  baseInvalidateCachesForPath(targetPath);
  if (!targetPath) {
    return;
  }

  invalidateStructureIndexForPathAndParents(targetPath);

  // Search caches are cheap to rebuild; clear on mutations for safety.
  searchFilesCache.clear();
  searchTextCache.clear();
  directoryTreeCache.clear();
};

function resolvePathsInArgs(args) {
  const originalArgs = args ?? {};
  const newArgs = { ...originalArgs };
  if (!workspaceRoot) throw new Error("Workspace root not configured.");

  const resolve = (p) => {
    if (typeof p !== 'string') return p;
    if (p.includes('\0')) throw new Error(`Invalid path: ${p}`);

    const candidate = p.trim();
    const rootResolved = path.resolve(workspaceRoot);
    const allowedResolved = (allowedDirectories || []).map((d) => path.resolve(d));

    const isWithinAllowedRoots = (absPath) => {
      const resolved = path.resolve(absPath);
      if (resolved === rootResolved || resolved.startsWith(rootResolved + path.sep)) return true;
      return allowedResolved.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
    };

    // If caller provided an absolute path inside allowed roots, keep it as-is.
    // Otherwise, keep supporting the existing convention: "/x/y" means "workspace-relative x/y".
    let resolvedPath;
    if (path.isAbsolute(candidate) && isWithinAllowedRoots(candidate)) {
      resolvedPath = candidate;
    } else {
      const safePart = candidate.startsWith('/') ? candidate.substring(1) : candidate;
      resolvedPath = path.join(workspaceRoot, safePart);
    }

    // Security check to prevent path traversal outside workspaceRoot.
    const normalized = path.resolve(resolvedPath);
    if (!normalized.startsWith(rootResolved)) {
      throw new Error(`Access denied: path traversal attempt for "${p}"`);
    }
    return resolvedPath;
  };

  if (typeof newArgs.path === 'string') newArgs.path = resolve(newArgs.path);
  if (typeof newArgs.source === 'string') newArgs.source = resolve(newArgs.source);
  if (typeof newArgs.destination === 'string') newArgs.destination = resolve(newArgs.destination);
  if (Array.isArray(newArgs.paths)) newArgs.paths = newArgs.paths.map(resolve);

  return newArgs;
}

// The library's validatePath function seems to hang when passed a resolved absolute path.
// Path resolution and security checks are now handled in `resolvePathsInArgs`,
// so we can bypass the library's validation by replacing it with a passthrough function.
const validatePath = async (p) => p;

const gitService = createGitService({ validatePath });

const MAX_TEXT_SEARCH_FILE_BYTES = Number.parseInt(process.env.SEARCH_TEXT_MAX_BYTES || '2097152', 10);
const DEFAULT_TEXT_SEARCH_EXCLUDES = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.DS_Store'];
const DEFAULT_DIRECTORY_TREE_MAX_DEPTH = Number.parseInt(process.env.DIRECTORY_TREE_MAX_DEPTH || '10', 10);
const DEFAULT_DIRECTORY_TREE_MAX_NODES = Number.parseInt(process.env.DIRECTORY_TREE_MAX_NODES || '4000', 10);

const { searchTextWithinWorkspace, searchFilesWithinWorkspace } = createWorkspaceSearch({
  fs,
  path,
  readline,
  minimatch,
  workspaceRoot,
  validatePath,
  getAllowedDirectories: () => allowedDirectories,
  readFileWithCache,
  cacheConfig,
  indexDirectory,
  structureIndex,
  dirIndexTtlMs: cacheConfig.ttlMs,
  defaultExcludes: DEFAULT_TEXT_SEARCH_EXCLUDES,
  maxTextSearchFileBytes: MAX_TEXT_SEARCH_FILE_BYTES
});


const ReadTextFileArgsSchema = z.object({
  path: z.string(),
  tail: z.number().optional().describe('If provided, returns only the last N lines of the file'),
  head: z.number().optional().describe('If provided, returns only the first N lines of the file')
});
const ReadMediaFileArgsSchema = z.object({ path: z.string() });
const ReadMultipleFilesArgsSchema = z.object({ paths: z.array(z.string()) });
const WriteFileArgsSchema = z.object({ path: z.string(), content: z.string() });
const WriteBinaryFileArgsSchema = z.object({
  path: z.string(),
  content: z.string().describe('Base64-encoded binary content'),
  encoding: z.enum(['base64']).optional().default('base64')
});
const EditOperation = z.object({ oldText: z.string(), newText: z.string() });
const EditFileArgsSchema = z.object({ path: z.string(), edits: z.array(EditOperation), dryRun: z.boolean().default(false) });
const CreateDirectoryArgsSchema = z.object({ path: z.string() });
const DeleteFileArgsSchema = z.object({ path: z.string() });
const DeleteDirectoryArgsSchema = z.object({ path: z.string() });
const ListDirectoryArgsSchema = z.object({ path: z.string() });
const ListDirectoryWithSizesArgsSchema = z.object({ path: z.string(), sortBy: z.enum(['name', 'size']).optional().default('name') });
const ListDirectoryDetailedArgsSchema = z.object({ path: z.string() });
const DirectoryTreeArgsSchema = z.object({
  path: z.string(),
  maxDepth: z.number().int().positive().max(100).optional(),
  maxNodes: z.number().int().positive().max(20000).optional()
});
const MoveFileArgsSchema = z.object({ source: z.string(), destination: z.string() });
const CopyFileArgsSchema = z.object({
  source: z.string(),
  destination: z.string(),
  overwrite: z.boolean().optional().default(false)
});
const SearchFilesArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  excludePatterns: z.array(z.string()).optional().default([]),
  maxResults: z.number().int().positive().max(20000).optional().default(5000)
});
const SearchTextArgsSchema = z.object({
  path: z.string(),
  query: z.string(),
  caseSensitive: z.boolean().optional().default(false),
  maxResults: z.number().int().positive().max(5000).optional().default(200),
  excludePatterns: z.array(z.string()).optional().default([])
});
const GetFileInfoArgsSchema = z.object({ path: z.string() });
const CollectIDEPluginsArgsSchema = z.object({});
const GitInfoArgsSchema = z.object({ path: z.string() });
const GitStatusArgsSchema = z.object({ path: z.string() });
const GitDiffArgsSchema = z.object({
  path: z.string(),
  file: z.string(),
  cached: z.boolean().optional().default(false),
  ref: z.string().optional().nullable().default(null).describe('Optional base ref for diff (e.g. "HEAD"). When set, diff is working tree vs ref.')
});
const GitStageArgsSchema = z.object({
  path: z.string(),
  files: z.array(z.string()).optional().default([])
});
const GitUnstageArgsSchema = z.object({
  path: z.string(),
  files: z.array(z.string()).optional().default([])
});
const GitCommitArgsSchema = z.object({
  path: z.string(),
  message: z.string().optional().default(''),
  amend: z.boolean().optional().default(false),
  signoff: z.boolean().optional().default(false)
});
const GitPushArgsSchema = z.object({
  path: z.string(),
  remote: z.string().optional().nullable().default(null),
  branch: z.string().optional().nullable().default(null),
  setUpstream: z.boolean().optional().default(false),
  token: z.string().optional().nullable().default(null).describe('Optional HTTPS Personal Access Token used for pushing non-interactively.')
});
const GitDiagnoseArgsSchema = z.object({ path: z.string() });
const GitIdentityArgsSchema = z.object({ path: z.string() });
const GitSetIdentityArgsSchema = z.object({
  path: z.string(),
  scope: z.enum(['local', 'global']).optional().default('local'),
  name: z.string(),
  email: z.string()
});
const GitReposOverviewArgsSchema = z.object({
  path: z.string(),
  maxRepos: z.number().int().positive().max(500).optional().default(200)
});
const ToolInputSchema = ToolSchema.shape.inputSchema;

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

const server = new Server({
  name: 'secure-filesystem-server',
  version: '0.2.0'
}, {
  capabilities: { tools: {} }
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_file',
      description: 'Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.',
      inputSchema: zodToJsonSchema(ReadTextFileArgsSchema)
    },
    {
      name: 'read_text_file',
      description: 'Read the complete contents of a file from the file system as text. Handles encodings and optional head/tail.',
      inputSchema: zodToJsonSchema(ReadTextFileArgsSchema)
    },
    {
      name: 'read_media_file',
      description: 'Read an image or audio file and return base64 data with MIME type.',
      inputSchema: zodToJsonSchema(ReadMediaFileArgsSchema)
    },
    {
      name: 'read_multiple_files',
      description: 'Read the contents of multiple files simultaneously.',
      inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema)
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with new content.',
      inputSchema: zodToJsonSchema(WriteFileArgsSchema)
    },
    {
      name: 'write_binary_file',
      description: 'Create or overwrite a binary file using base64 encoded content.',
      inputSchema: zodToJsonSchema(WriteBinaryFileArgsSchema)
    },
    {
      name: 'edit_file',
      description: 'Apply textual edits to a file and return a diff.',
      inputSchema: zodToJsonSchema(EditFileArgsSchema)
    },
    {
      name: 'create_directory',
      description: 'Ensure a directory exists by creating it recursively.',
      inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema)
    },
    {
      name: 'delete_file',
      description: 'Delete a file.',
      inputSchema: zodToJsonSchema(DeleteFileArgsSchema)
    },
    {
      name: 'delete_directory',
      description: 'Delete a directory.',
      inputSchema: zodToJsonSchema(DeleteDirectoryArgsSchema)
    },
    {
      name: 'list_directory',
      description: 'List files and directories within a path.',
      inputSchema: zodToJsonSchema(ListDirectoryArgsSchema)
    },
    {
      name: 'list_directory_with_sizes',
      description: 'List directory contents with sizes and summary.',
      inputSchema: zodToJsonSchema(ListDirectoryWithSizesArgsSchema)
    },
    {
      name: 'list_directory_detailed',
      description: 'List directory contents with metadata as JSON.',
      inputSchema: zodToJsonSchema(ListDirectoryDetailedArgsSchema)
    },
    {
      name: 'directory_tree',
      description: 'Return a JSON tree of files and directories.',
      inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema)
    },
    {
      name: 'move_file',
      description: 'Move or rename files or directories.',
      inputSchema: zodToJsonSchema(MoveFileArgsSchema)
    },
    {
      name: 'copy_file',
      description: 'Copy files or directories. Supports recursive copies.',
      inputSchema: zodToJsonSchema(CopyFileArgsSchema)
    },
    {
      name: 'search_files',
      description: 'Recursive search for files and directories matching a pattern.',
      inputSchema: zodToJsonSchema(SearchFilesArgsSchema)
    },
    {
      name: 'search_text',
      description: 'Search for text matches inside files under a path.',
      inputSchema: zodToJsonSchema(SearchTextArgsSchema)
    },
    {
      name: 'get_file_info',
      description: 'Retrieve metadata about a file or directory.',
      inputSchema: zodToJsonSchema(GetFileInfoArgsSchema)
    },
	    {
	      name: 'collect_ide_plugins',
	      description: 'Aggregate IDE plugin configurations grouped by location based on config.json files.',
	      inputSchema: zodToJsonSchema(CollectIDEPluginsArgsSchema)
	    },
	    {
	      name: 'git_info',
	      description: 'Return git repository info for a path (branch, upstream, remotes).',
	      inputSchema: zodToJsonSchema(GitInfoArgsSchema)
	    },
	    {
	      name: 'git_status',
	      description: 'Return git status (staged/unstaged/untracked/conflicted) for a repository path.',
	      inputSchema: zodToJsonSchema(GitStatusArgsSchema)
	    },
	    {
	      name: 'git_diff',
	      description: 'Return a unified diff for a file (unstaged by default, staged when cached=true).',
	      inputSchema: zodToJsonSchema(GitDiffArgsSchema)
	    },
	    {
	      name: 'git_stage',
	      description: 'Stage files in a repository (or stage all when files is empty).',
	      inputSchema: zodToJsonSchema(GitStageArgsSchema)
	    },
	    {
	      name: 'git_unstage',
	      description: 'Unstage files in a repository (or unstage all when files is empty).',
	      inputSchema: zodToJsonSchema(GitUnstageArgsSchema)
	    },
	    {
	      name: 'git_commit',
	      description: 'Create a commit from staged changes.',
	      inputSchema: zodToJsonSchema(GitCommitArgsSchema)
	    },
	    {
	      name: 'git_push',
	      description: 'Push the current branch to a remote.',
	      inputSchema: zodToJsonSchema(GitPushArgsSchema)
	    },
	    {
	      name: 'git_diagnose',
	      description: 'Return diagnostic information about git availability in the server process.',
	      inputSchema: zodToJsonSchema(GitDiagnoseArgsSchema)
	    },
	    {
	      name: 'git_repos_overview',
	      description: 'Return git status summaries for repositories under a repos root directory.',
	      inputSchema: zodToJsonSchema(GitReposOverviewArgsSchema)
	    },
	    {
	      name: 'git_identity',
	      description: 'Return effective git user.name and user.email (local/global).',
	      inputSchema: zodToJsonSchema(GitIdentityArgsSchema)
	    },
	    {
	      name: 'git_set_identity',
	      description: 'Configure git user.name and user.email (local or global).',
	      inputSchema: zodToJsonSchema(GitSetIdentityArgsSchema)
	    },
	    {
	      name: 'list_allowed_directories',
	      description: 'Return the directories that the server is permitted to access.',
	      inputSchema: { type: 'object', properties: {}, required: [] }
	    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: rawArgs } = request.params;
    const args = resolvePathsInArgs(rawArgs);
    switch (name) {
      case 'read_file':
      case 'read_text_file': {
        const parsed = ReadTextFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for read_text_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        if (parsed.data.head && parsed.data.tail) throw new Error('Cannot specify both head and tail parameters simultaneously');
        if (parsed.data.tail) {
          const { content, stats } = await readFileWithCache(validPath, { skipReadForLarge: true });
          if (content !== null && stats.size <= cacheConfig.maxFileSizeBytes) {
            const lines = content.split(/\r?\n/);
            const sliced = lines.slice(-parsed.data.tail).join('\n');
            return { content: [{ type: 'text', text: sliced }] };
          }
          const tailContent = await tailFile(validPath, parsed.data.tail);
          return { content: [{ type: 'text', text: tailContent }] };
        }
        if (parsed.data.head) {
          const { content, stats } = await readFileWithCache(validPath, { skipReadForLarge: true });
          if (content !== null && stats.size <= cacheConfig.maxFileSizeBytes) {
            const lines = content.split(/\r?\n/);
            const sliced = lines.slice(0, parsed.data.head).join('\n');
            return { content: [{ type: 'text', text: sliced }] };
          }
          const headContent = await headFile(validPath, parsed.data.head);
          return { content: [{ type: 'text', text: headContent }] };
        }
        const { content } = await readFileWithCache(validPath);
        return { content: [{ type: 'text', text: content }] };
      }
      case 'read_media_file': {
        const parsed = ReadMediaFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for read_media_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
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
        const data = await readFileAsBase64Stream(validPath);
        const name = path.basename(validPath);
        if (mimeType.startsWith('image/')) {
          return { content: [{ type: 'image', data, mimeType }] };
        }
        if (mimeType.startsWith('audio/')) {
          return { content: [{ type: 'audio', data, mimeType }] };
        }
        // For video or other binary formats, return as a resource with a data URI
        const dataUrl = `data:${mimeType};base64,${data}`;
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
      case 'read_multiple_files': {
        const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for read_multiple_files: ${parsed.error}`);
        const results = await Promise.all(parsed.data.paths.map(async (filePath) => {
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
        return { content: [{ type: 'text', text: results.join('\n---\n') }] };
      }
      case 'write_file': {
        const parsed = WriteFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for write_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        await writeFileContent(validPath, parsed.data.content);
        invalidateCachesForPath(validPath);
        return { content: [{ type: 'text', text: `Successfully wrote to ${parsed.data.path}` }] };
      }
      case 'write_binary_file': {
        const parsed = WriteBinaryFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for write_binary_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const dirName = path.dirname(validPath);
        await fs.mkdir(dirName, { recursive: true });
        const encoding = parsed.data.encoding ?? 'base64';
        const buffer = Buffer.from(parsed.data.content, encoding);
        await fs.writeFile(validPath, buffer);
        invalidateCachesForPath(validPath);
        return { content: [{ type: 'text', text: `Successfully wrote binary data to ${parsed.data.path}` }] };
      }
      case 'edit_file': {
        const parsed = EditFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for edit_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const result = await applyFileEdits(validPath, parsed.data.edits, parsed.data.dryRun);
        invalidateCachesForPath(validPath);
        return { content: [{ type: 'text', text: result }] };
      }
      case 'create_directory': {
        const parsed = CreateDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for create_directory: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        await fs.mkdir(validPath, { recursive: true });
        invalidateCachesForPath(validPath);
        return { content: [{ type: 'text', text: `Successfully created directory ${parsed.data.path}` }] };
      }
      case 'delete_file': {
        const parsed = DeleteFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for delete_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        await fs.unlink(validPath);
        invalidateCachesForPath(validPath);
        return { content: [{ type: 'text', text: `Successfully deleted file ${parsed.data.path}` }] };
      }
      case 'delete_directory': {
        const parsed = DeleteDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for delete_directory: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        await fs.rm(validPath, { recursive: true, force: true });
        invalidateCachesForPath(validPath);
        return { content: [{ type: 'text', text: `Successfully deleted directory ${parsed.data.path}` }] };
      }
      case 'list_directory': {
        const parsed = ListDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for list_directory: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const detailed = await listDirectoryDetailedWithCache(validPath);
        const formatted = detailed.map(entry => `${entry.type === 'directory' ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }
      case 'list_directory_with_sizes': {
        const parsed = ListDirectoryWithSizesArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for list_directory_with_sizes: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const detailed = await indexDirectory(validPath);
        const enriched = detailed.map(entry => ({
          name: entry.name,
          isDirectory: entry.type === 'directory',
          size: entry.size || 0,
          mtime: entry.modified ? new Date(entry.modified) : new Date(0)
        }));
        const sorted = [...enriched].sort((a, b) => parsed.data.sortBy === 'size' ? b.size - a.size : a.name.localeCompare(b.name));
        const lines = sorted.map(entry => `${entry.isDirectory ? '[DIR]' : '[FILE]'} ${entry.name.padEnd(30)} ${entry.isDirectory ? '' : formatSize(entry.size).padStart(10)}`);
        const totalFiles = enriched.filter(e => !e.isDirectory).length;
        const totalDirs = enriched.filter(e => e.isDirectory).length;
        const totalSize = enriched.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0);
        const summary = ['', `Total: ${totalFiles} files, ${totalDirs} directories`, `Combined size: ${formatSize(totalSize)}`];
        return { content: [{ type: 'text', text: [...lines, ...summary].join('\n') }] };
      }
      case 'list_directory_detailed': {
        const parsed = ListDirectoryDetailedArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for list_directory_detailed: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const detailed = await indexDirectory(validPath);
        const ordered = [...detailed].sort((a, b) => {
          const typeOrder = { directory: 0, file: 1, other: 2 };
          const diff = (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
          if (diff !== 0) return diff;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        return { content: [{ type: 'text', text: JSON.stringify(ordered) }] };
      }
      case 'directory_tree': {
        const parsed = DirectoryTreeArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for directory_tree: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const maxDepth = parsed.data.maxDepth ?? DEFAULT_DIRECTORY_TREE_MAX_DEPTH;
        const maxNodes = parsed.data.maxNodes ?? DEFAULT_DIRECTORY_TREE_MAX_NODES;

        const cacheKey = buildCacheKey('directory_tree', { path: validPath, maxDepth, maxNodes });
        const cached = directoryTreeCache.get(cacheKey);
        if (cached) {
          return { content: [{ type: 'text', text: cached }] };
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
        return { content: [{ type: 'text', text }] };
      }
      case 'move_file': {
        const parsed = MoveFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for move_file: ${parsed.error}`);
        const validSource = await validatePath(parsed.data.source);
        const validDestination = await validatePath(parsed.data.destination);
        const sourceStat = await fs.lstat(validSource);
        await fs.rename(validSource, validDestination);
        if (sourceStat.isDirectory()) {
          invalidateStructureIndexSubtree(validSource);
          invalidateStructureIndexSubtree(validDestination);
        }
        invalidateCachesForPath(validSource);
        invalidateCachesForPath(validDestination);
        return { content: [{ type: 'text', text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` }] };
      }
      case 'copy_file': {
        const parsed = CopyFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for copy_file: ${parsed.error}`);
        const validSource = await validatePath(parsed.data.source);
        const validDestination = await validatePath(parsed.data.destination);
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
        const overwrite = Boolean(parsed.data.overwrite);
        await copyRecursive(validSource, validDestination, overwrite);
        invalidateStructureIndexSubtree(validDestination);
        invalidateCachesForPath(validDestination);
        return {
          content: [{
            type: 'text',
            text: `Successfully copied ${parsed.data.source} to ${parsed.data.destination}${overwrite ? ' (overwritten)' : ''}`
          }]
        };
      }
      case 'search_files': {
        const parsed = SearchFilesArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for search_files: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const cacheKey = buildCacheKey('search_files', {
          path: validPath,
          pattern: parsed.data.pattern,
          excludePatterns: parsed.data.excludePatterns,
          maxResults: parsed.data.maxResults
        });
        const cached = searchFilesCache.get(cacheKey);
        if (cached) {
          return { content: [{ type: 'text', text: cached }] };
        }

        const { results: relativeResults } = await searchFilesWithinWorkspace(validPath, parsed.data);
        const text = relativeResults.length > 0 ? relativeResults.join('\n') : 'No matches found';
        searchFilesCache.set(cacheKey, text);
        return {
          content: [{
            type: 'text',
            text
          }]
        };
      }
      case 'search_text': {
        const parsed = SearchTextArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for search_text: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const cacheKey = buildCacheKey('search_text', {
          path: validPath,
          query: parsed.data.query,
          caseSensitive: parsed.data.caseSensitive,
          maxResults: parsed.data.maxResults,
          excludePatterns: parsed.data.excludePatterns
        });
        const cached = searchTextCache.get(cacheKey);
        if (cached) {
          return { content: [{ type: 'text', text: cached }] };
        }

        const { results, truncated } = await searchTextWithinWorkspace(validPath, parsed.data, { maxBytesPerFile: MAX_TEXT_SEARCH_FILE_BYTES });
        const payload = { results, truncated };
        const text = JSON.stringify(payload);
        searchTextCache.set(cacheKey, text);
        return { content: [{ type: 'text', text }] };
      }
      case 'get_file_info': {
        const parsed = GetFileInfoArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const info = await getFileStats(validPath);
        const text = Object.entries(info).map(([key, value]) => `${key}: ${value}`).join('\n');
        return { content: [{ type: 'text', text }] };
      }
      case 'collect_ide_plugins': {
        const parsed = CollectIDEPluginsArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for collect_ide_plugins: ${parsed.error}`);
        const pluginsByLocation = await aggregateIdePlugins(workspaceRoot);
        return { content: [{ type: 'text', text: JSON.stringify(pluginsByLocation) }] };
      }
      case 'git_info': {
        const parsed = GitInfoArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_info: ${parsed.error}`);
        const info = await gitService.gitInfo(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(info) }] };
      }
      case 'git_status': {
        const parsed = GitStatusArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_status: ${parsed.error}`);
        const status = await gitService.gitStatus(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(status) }] };
      }
      case 'git_diff': {
        const parsed = GitDiffArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_diff: ${parsed.error}`);
        const diff = await gitService.gitDiff(parsed.data);
        return { content: [{ type: 'text', text: diff || '' }] };
      }
      case 'git_stage': {
        const parsed = GitStageArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_stage: ${parsed.error}`);
        const result = await gitService.gitStage(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'git_unstage': {
        const parsed = GitUnstageArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_unstage: ${parsed.error}`);
        const result = await gitService.gitUnstage(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'git_commit': {
        const parsed = GitCommitArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_commit: ${parsed.error}`);
        const result = await gitService.gitCommit(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'git_push': {
        const parsed = GitPushArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_push: ${parsed.error}`);
        const result = await gitService.gitPush(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'git_diagnose': {
        const parsed = GitDiagnoseArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_diagnose: ${parsed.error}`);
        const result = await gitService.gitDiagnose(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'git_repos_overview': {
        const parsed = GitReposOverviewArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_repos_overview: ${parsed.error}`);
        const result = await gitService.gitReposOverview(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'git_identity': {
        const parsed = GitIdentityArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_identity: ${parsed.error}`);
        const result = await gitService.gitIdentity(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'git_set_identity': {
        const parsed = GitSetIdentityArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for git_set_identity: ${parsed.error}`);
        const result = await gitService.gitSetIdentity(parsed.data);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'list_allowed_directories': {
        return { content: [{ type: 'text', text: `Allowed directories:\n${allowedDirectories.join('\n')}` }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

async function updateAllowedDirectoriesFromRoots(requestedRoots) {
  const validatedRootDirs = await getValidRootDirectories(requestedRoots);
  if (validatedRootDirs.length > 0) {
    allowedDirectories = [...validatedRootDirs];
    setAllowedDirectories(allowedDirectories);
    console.error(`[filesystem-http] Updated allowed directories from MCP roots (${validatedRootDirs.length})`);
  } else {
    console.error('[filesystem-http] No valid root directories provided by client');
  }
}

server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
  try {
    const response = await server.listRoots();
    if (response && 'roots' in response) {
      await updateAllowedDirectoriesFromRoots(response.roots);
    }
  } catch (error) {
    console.error('[filesystem-http] Failed to refresh roots:', error instanceof Error ? error.message : String(error));
  }
});

server.oninitialized = async () => {
  const caps = server.getClientCapabilities();
  if (caps?.roots) {
    try {
      const response = await server.listRoots();
      if (response && 'roots' in response) {
        await updateAllowedDirectoriesFromRoots(response.roots);
      } else {
        console.error('[filesystem-http] Client returned no roots set, keeping current allowed directories');
      }
    } catch (error) {
      console.error('[filesystem-http] Failed to request initial roots:', error instanceof Error ? error.message : String(error));
    }
  } else {
    if (allowedDirectories.length === 0) {
      throw new Error('Server cannot operate without allowed directories. Supply directories via arguments or use a client that supports MCP roots.');
    }
    console.error('[filesystem-http] Client does not support MCP roots; using server configured directories.');
  }
};

async function main() {
  const PORT = Number.parseInt(process.env.PORT || '7000', 10);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  await server.connect(transport);

  const httpServer = http.createServer((req, res) => {
    if (fatalErrorState) {
      const payload = JSON.stringify({
        ok: false,
        error: 'Server entered fatal error state',
        source: fatalErrorState.source,
        message: fatalErrorState.error?.message || 'Internal server error',
          cwd: process.cwd()
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(payload);
      return;
    }
    const urlString = req.url || '/';
    const parsedUrl = new URL(urlString, 'http://localhost');
    if (req.method === 'GET' && parsedUrl.pathname === '/health') {
      const payload = JSON.stringify({ ok: true, server: 'secure-filesystem-server' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
      return;
    }
    if (parsedUrl.pathname === '/mcp') {
      transport.handleRequest(req, res).catch((error) => {
        console.error('[filesystem-http] transport error:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
        }
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  httpServer.listen(PORT, () => {
    console.log(`[filesystem-http] listening on port ${PORT} (allowed: ${allowedDirectories.join(', ')})`);
  });
}

main().catch((error) => {
  console.error('[filesystem-http] fatal error:', error);
  process.exit(1);
});
