#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs/promises';
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
import { loadFilesystemDeps, loadZodToJsonSchema } from './utils/server/deps.mjs';
import { getRequestedRoots, resolveAllowedDirectories } from './utils/server/env-config.mjs';
import { createCacheConfig, initCacheHelpers } from './utils/server/cache-setup.mjs';
import { createSchemas } from './utils/server/schemas.mjs';
import { buildToolDefinitions } from './utils/server/tool-definitions.mjs';
import { createToolHandlers } from './utils/server/tool-handlers.mjs';
import { errorResponse } from './utils/server/responses.mjs';

const { Server } = mcpServer;
const { StreamableHTTPServerTransport } = mcpStreamHttp;
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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

const zodToJsonSchema = await loadZodToJsonSchema({ recordFatalError });

const {
  normalizePath,
  expandHome,
  getValidRootDirectories,
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
} = await loadFilesystemDeps({ recordFatalError });

const args = getRequestedRoots(process.argv.slice(2), process.env);

let allowedDirectories = [];
try {
  allowedDirectories = await resolveAllowedDirectories(args, { expandHome, normalizePath, fs, path });
  setAllowedDirectories(allowedDirectories);
} catch (error) {
  recordFatalError('init:allowed-directories', error);
  allowedDirectories = [];
}

const workspaceRoot = allowedDirectories.length > 0 ? allowedDirectories[0] : path.resolve(process.cwd());
if (allowedDirectories.length > 1) {
  console.warn(`[filesystem-http] Multiple allowed directories found, using the first one as workspace root: ${workspaceRoot}`);
}

let cacheConfig = createCacheConfig(process.env);

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
  const cacheHelpers = initCacheHelpers({
    createCacheHelpers,
    readFileContent,
    cacheConfig,
    fs,
    path
  });
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

function getResolvedAllowedRoots() {
  const roots = [workspaceRoot, ...(allowedDirectories || [])]
    .filter(Boolean)
    .map((dir) => path.resolve(dir));
  return Array.from(new Set(roots));
}

function isPathWithinRoots(candidatePath, roots = getResolvedAllowedRoots()) {
  const resolvedCandidate = path.resolve(candidatePath);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    if (resolvedCandidate === resolvedRoot) return true;
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
}

async function resolveCanonicalPath(targetPath) {
  const normalizedTarget = path.resolve(targetPath);
  try {
    return await fs.realpath(normalizedTarget);
  } catch {
    let current = path.dirname(normalizedTarget);
    while (true) {
      try {
        const realCurrent = await fs.realpath(current);
        const suffix = path.relative(current, normalizedTarget);
        return path.resolve(realCurrent, suffix);
      } catch {
        const parent = path.dirname(current);
        if (parent === current) {
          return null;
        }
        current = parent;
      }
    }
  }
}

async function resolvePathInAllowedRoots(inputPath) {
  if (typeof inputPath !== 'string') return inputPath;
  if (!workspaceRoot) throw new Error('Workspace root not configured.');
  if (inputPath.includes('\0')) throw new Error(`Invalid path: ${inputPath}`);
  const candidate = inputPath.trim();
  const roots = getResolvedAllowedRoots();
  const workspaceResolved = path.resolve(workspaceRoot);

  let resolvedPath;
  if (path.isAbsolute(candidate) && isPathWithinRoots(candidate, roots)) {
    resolvedPath = path.resolve(candidate);
  } else {
    const safePart = candidate.startsWith('/') ? candidate.slice(1) : candidate;
    resolvedPath = path.resolve(workspaceResolved, safePart);
  }

  if (!isPathWithinRoots(resolvedPath, roots)) {
    throw new Error(`Access denied: path traversal attempt for "${inputPath}"`);
  }

  const canonicalPath = await resolveCanonicalPath(resolvedPath);
  if (!canonicalPath || !isPathWithinRoots(canonicalPath, roots)) {
    throw new Error(`Access denied: symlink escape attempt for "${inputPath}"`);
  }

  return canonicalPath;
}

async function resolvePathsInArgs(args) {
  const originalArgs = args ?? {};
  const newArgs = { ...originalArgs };
  if (typeof newArgs.path === 'string') newArgs.path = await resolvePathInAllowedRoots(newArgs.path);
  if (typeof newArgs.source === 'string') newArgs.source = await resolvePathInAllowedRoots(newArgs.source);
  if (typeof newArgs.destination === 'string') newArgs.destination = await resolvePathInAllowedRoots(newArgs.destination);
  if (Array.isArray(newArgs.paths)) newArgs.paths = await Promise.all(newArgs.paths.map(resolvePathInAllowedRoots));

  return newArgs;
}

const validatePath = async (p) => resolvePathInAllowedRoots(p);

const gitService = createGitService({ validatePath });

const MAX_TEXT_SEARCH_FILE_BYTES = Number.parseInt(process.env.SEARCH_TEXT_MAX_BYTES || '2097152', 10);
const SEARCH_TEXT_TIMEOUT_MS = Number.parseInt(process.env.SEARCH_TEXT_TIMEOUT_MS || '30000', 10);
const REPLACE_TEXT_TIMEOUT_MS = Number.parseInt(process.env.REPLACE_TEXT_TIMEOUT_MS || '45000', 10);
const DEFAULT_TEXT_SEARCH_EXCLUDES = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.DS_Store'];
const DEFAULT_DIRECTORY_TREE_MAX_DEPTH = Number.parseInt(process.env.DIRECTORY_TREE_MAX_DEPTH || '10', 10);
const DEFAULT_DIRECTORY_TREE_MAX_NODES = Number.parseInt(process.env.DIRECTORY_TREE_MAX_NODES || '4000', 10);

const { searchTextWithinWorkspace, searchFilesWithinWorkspace, replaceTextWithinWorkspace } = createWorkspaceSearch({
  fs,
  path,
  readline,
  minimatch,
  workspaceRoot,
  validatePath,
  getAllowedDirectories: () => allowedDirectories,
  readFileWithCache,
  writeFileContent,
  cacheConfig,
  indexDirectory,
  structureIndex,
  dirIndexTtlMs: cacheConfig.ttlMs,
  defaultExcludes: DEFAULT_TEXT_SEARCH_EXCLUDES,
  maxTextSearchFileBytes: MAX_TEXT_SEARCH_FILE_BYTES
});

const schemas = createSchemas(z);

const toolHandlers = createToolHandlers({
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
  gitService,
  MAX_TEXT_SEARCH_FILE_BYTES,
  SEARCH_TEXT_TIMEOUT_MS,
  REPLACE_TEXT_TIMEOUT_MS,
  DEFAULT_DIRECTORY_TREE_MAX_DEPTH,
  DEFAULT_DIRECTORY_TREE_MAX_NODES,
  getAllowedDirectories: () => allowedDirectories
});

const server = new Server({
  name: 'secure-filesystem-server',
  version: '0.2.0'
}, {
  capabilities: { tools: {} }
});

const toolDefinitions = buildToolDefinitions(zodToJsonSchema, schemas);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: rawArgs } = request.params;
    const args = await resolvePathsInArgs(rawArgs);
    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return await handler(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
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
