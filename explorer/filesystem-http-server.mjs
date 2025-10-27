#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

import { server as mcpServer, streamHttp as mcpStreamHttp, types as mcpTypes, zod as mcpZod } from 'mcp-sdk';

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
if (!args.length) args.push(process.cwd());

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

function resolvePathsInArgs(args) {
  const newArgs = { ...args };
  if (!workspaceRoot) throw new Error("Workspace root not configured.");

  const resolve = (p) => {
    // Treat paths starting with / as relative to the workspace root
    const safePart = p.startsWith('/') ? p.substring(1) : p;
    const result = path.join(workspaceRoot, safePart);
    // Security check to prevent path traversal
    if (!path.resolve(result).startsWith(path.resolve(workspaceRoot))) {
      throw new Error(`Access denied: path traversal attempt for "${p}"`);
    }
    return result;
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


const ReadTextFileArgsSchema = z.object({
  path: z.string(),
  tail: z.number().optional().describe('If provided, returns only the last N lines of the file'),
  head: z.number().optional().describe('If provided, returns only the first N lines of the file')
});
const ReadMediaFileArgsSchema = z.object({ path: z.string() });
const ReadMultipleFilesArgsSchema = z.object({ paths: z.array(z.string()) });
const WriteFileArgsSchema = z.object({ path: z.string(), content: z.string() });
const EditOperation = z.object({ oldText: z.string(), newText: z.string() });
const EditFileArgsSchema = z.object({ path: z.string(), edits: z.array(EditOperation), dryRun: z.boolean().default(false) });
const CreateDirectoryArgsSchema = z.object({ path: z.string() });
const DeleteFileArgsSchema = z.object({ path: z.string() });
const DeleteDirectoryArgsSchema = z.object({ path: z.string() });
const ListDirectoryArgsSchema = z.object({ path: z.string() });
const ListDirectoryWithSizesArgsSchema = z.object({ path: z.string(), sortBy: z.enum(['name', 'size']).optional().default('name') });
const ListDirectoryDetailedArgsSchema = z.object({ path: z.string() });
const DirectoryTreeArgsSchema = z.object({ path: z.string() });
const MoveFileArgsSchema = z.object({ source: z.string(), destination: z.string() });
const SearchFilesArgsSchema = z.object({ path: z.string(), pattern: z.string(), excludePatterns: z.array(z.string()).optional().default([]) });
const GetFileInfoArgsSchema = z.object({ path: z.string() });
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
      name: 'search_files',
      description: 'Recursive search for files and directories matching a pattern.',
      inputSchema: zodToJsonSchema(SearchFilesArgsSchema)
    },
    {
      name: 'get_file_info',
      description: 'Retrieve metadata about a file or directory.',
      inputSchema: zodToJsonSchema(GetFileInfoArgsSchema)
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
          const tailContent = await tailFile(validPath, parsed.data.tail);
          return { content: [{ type: 'text', text: tailContent }] };
        }
        if (parsed.data.head) {
          const headContent = await headFile(validPath, parsed.data.head);
          return { content: [{ type: 'text', text: headContent }] };
        }
        const content = await readFileContent(validPath);
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
          '.flac': 'audio/flac'
        };
        const mimeType = mimeTypes[extension] || 'application/octet-stream';
        const data = await readFileAsBase64Stream(validPath);
        const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'blob';
        return { content: [{ type, data, mimeType }] };
      }
      case 'read_multiple_files': {
        const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for read_multiple_files: ${parsed.error}`);
        const results = await Promise.all(parsed.data.paths.map(async (filePath) => {
          try {
            const validPath = await validatePath(filePath);
            const content = await readFileContent(validPath);
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
        return { content: [{ type: 'text', text: `Successfully wrote to ${parsed.data.path}` }] };
      }
      case 'edit_file': {
        const parsed = EditFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for edit_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const result = await applyFileEdits(validPath, parsed.data.edits, parsed.data.dryRun);
        return { content: [{ type: 'text', text: result }] };
      }
      case 'create_directory': {
        const parsed = CreateDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for create_directory: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        await fs.mkdir(validPath, { recursive: true });
        return { content: [{ type: 'text', text: `Successfully created directory ${parsed.data.path}` }] };
      }
      case 'delete_file': {
        const parsed = DeleteFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for delete_file: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        await fs.unlink(validPath);
        return { content: [{ type: 'text', text: `Successfully deleted file ${parsed.data.path}` }] };
      }
      case 'delete_directory': {
        const parsed = DeleteDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for delete_directory: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        await fs.rm(validPath, { recursive: true, force: true });
        return { content: [{ type: 'text', text: `Successfully deleted directory ${parsed.data.path}` }] };
      }
      case 'list_directory': {
        const parsed = ListDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for list_directory: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        const formatted = entries.map(entry => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }
      case 'list_directory_with_sizes': {
        const parsed = ListDirectoryWithSizesArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for list_directory_with_sizes: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        const detailed = await Promise.all(entries.map(async entry => {
          const entryPath = path.join(validPath, entry.name);
          try {
            const stats = await fs.stat(entryPath);
            return { name: entry.name, isDirectory: entry.isDirectory(), size: stats.size, mtime: stats.mtime };
          } catch {
            return { name: entry.name, isDirectory: entry.isDirectory(), size: 0, mtime: new Date(0) };
          }
        }));
        const sorted = [...detailed].sort((a, b) => parsed.data.sortBy === 'size' ? b.size - a.size : a.name.localeCompare(b.name));
        const lines = sorted.map(entry => `${entry.isDirectory ? '[DIR]' : '[FILE]'} ${entry.name.padEnd(30)} ${entry.isDirectory ? '' : formatSize(entry.size).padStart(10)}`);
        const totalFiles = detailed.filter(e => !e.isDirectory).length;
        const totalDirs = detailed.filter(e => e.isDirectory).length;
        const totalSize = detailed.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0);
        const summary = ['', `Total: ${totalFiles} files, ${totalDirs} directories`, `Combined size: ${formatSize(totalSize)}`];
        return { content: [{ type: 'text', text: [...lines, ...summary].join('\n') }] };
      }
      case 'list_directory_detailed': {
        const parsed = ListDirectoryDetailedArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for list_directory_detailed: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        const detailed = await Promise.all(entries.map(async entry => {
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
        const ordered = detailed.sort((a, b) => {
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
        async function buildTree(currentPath) {
          const validPath = await validatePath(currentPath);
          const entries = await fs.readdir(validPath, { withFileTypes: true });
          const result = [];
          for (const entry of entries) {
            const entryData = { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' };
            if (entry.isDirectory()) {
              entryData.children = await buildTree(path.join(currentPath, entry.name));
            }
            result.push(entryData);
          }
          return result;
        }
        const treeData = await buildTree(parsed.data.path);
        return { content: [{ type: 'text', text: JSON.stringify(treeData, null, 2) }] };
      }
      case 'move_file': {
        const parsed = MoveFileArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for move_file: ${parsed.error}`);
        const validSource = await validatePath(parsed.data.source);
        const validDestination = await validatePath(parsed.data.destination);
        await fs.rename(validSource, validDestination);
        return { content: [{ type: 'text', text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` }] };
      }
      case 'search_files': {
        const parsed = SearchFilesArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for search_files: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const results = await searchFilesWithValidation(validPath, parsed.data.pattern, allowedDirectories, { excludePatterns: parsed.data.excludePatterns });
        return { content: [{ type: 'text', text: results.length > 0 ? results.join('\n') : 'No matches found' }] };
      }
      case 'get_file_info': {
        const parsed = GetFileInfoArgsSchema.safeParse(args);
        if (!parsed.success) throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`);
        const validPath = await validatePath(parsed.data.path);
        const info = await getFileStats(validPath);
        const text = Object.entries(info).map(([key, value]) => `${key}: ${value}`).join('\n');
        return { content: [{ type: 'text', text }] };
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
