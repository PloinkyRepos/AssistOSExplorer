#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  createEmptyBacklogMarkdown,
  createEmptyHistoryMarkdown,
  createNextTaskId,
  decorateBacklogTask as decorateBacklogTaskRecord,
  decorateHistoryTask as decorateHistoryTaskRecord,
  parseBacklogMarkdown,
  parseHistoryMarkdown,
  serializeBacklogMarkdown,
  serializeHistoryMarkdown
} from './backlog_markdown.mjs';

const DEFAULT_CONFIG = {
  statuses: {
    'new': 'New',
    'approved': 'Approved',
    'done': 'Done'
  }
};

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

async function readStdinFallback() {
  if (process.stdin.isTTY) {
    return '';
  }
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

function normalizeInput(envelope) {
  let current = envelope;
  for (let i = 0; i < 4; i += 1) {
    if (!current || typeof current !== 'object') break;
    if (current.input && typeof current.input === 'object') {
      current = current.input;
      continue;
    }
    if (current['arguments'] && typeof current['arguments'] === 'object') {
      current = current['arguments'];
      continue;
    }
    if (current.params?.['arguments'] && typeof current.params['arguments'] === 'object') {
      current = current.params['arguments'];
      continue;
    }
    if (current.params?.input && typeof current.params.input === 'object') {
      current = current.params.input;
      continue;
    }
    break;
  }
  return current && typeof current === 'object' ? current : {};
}

function getWorkspaceRoot() {
  const roots = [
    process.env.ASSISTOS_FS_ROOT,
    process.env.WORKSPACE_ROOT,
    process.env.PLOINKY_WORKSPACE_ROOT,
    process.env.MCP_FS_ROOT
  ].filter((value) => typeof value === 'string' && value.trim());
  for (const root of roots) {
    const resolved = path.resolve(root);
    try {
      if (fsSync.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // ignore invalid roots
    }
  }
  return process.cwd();
}

function normalizePloinkyPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return raw;
  const workspaceRoot = getWorkspaceRoot();
  const marker = '/.ploinky/repos';
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const suffix = raw.slice(idx + marker.length).replace(/^\/+/, '');
    return path.join(workspaceRoot, '.ploinky', 'repos', suffix);
  }
  if (raw.startsWith('/.ploinky/')) {
    const suffix = raw.replace(/^\/\.ploinky\//, '');
    return path.join(workspaceRoot, '.ploinky', suffix);
  }
  if (raw.startsWith('.ploinky/')) {
    const suffix = raw.replace(/^\.ploinky\//, '');
    return path.join(workspaceRoot, '.ploinky', suffix);
  }
  return raw;
}

function getRepoRootFromArgs(args = {}) {
  const repoPath = normalizePloinkyPath(normalizeString(args?.repoPath));
  if (!repoPath) {
    throw new Error('repoPath is required.');
  }
  if (repoPath.startsWith('/.ploinky/')) {
    throw new Error('repoPath must be an absolute filesystem path (e.g. /Users/.../repos/<repo>), not /.ploinky/...');
  }
  if (!path.isAbsolute(repoPath)) {
    throw new Error('repoPath must be an absolute path.');
  }
  const resolved = path.resolve(repoPath);
  if (!fsSync.existsSync(resolved)) {
    throw new Error(`repoPath does not exist: ${resolved}`);
  }
  if (!fsSync.statSync(resolved).isDirectory()) {
    throw new Error(`repoPath is not a directory: ${resolved}`);
  }
  return resolved;
}


function normalizeConfig(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  let statuses = cfg.statuses && typeof cfg.statuses === 'object' ? cfg.statuses : DEFAULT_CONFIG.statuses;
  if (statuses && (statuses.todo || statuses['in-progress'] || statuses['dev-ready'])) {
    statuses = DEFAULT_CONFIG.statuses;
  }
  return {
    statuses
  };
}

async function loadConfig() {
  return normalizeConfig(DEFAULT_CONFIG);
}

async function loadBacklogIndex(root, backlogPath = '') {
  const { tasks, backlogPaths, files } = await loadTasks(root, backlogPath);
  return { tasks, files, backlogPaths };
}

const BACKLOG_EXTENSION = '.backlog';
const BACKLOG_EXCLUDED_DIRS = new Set(['.git', '.ploinky', '.data', 'node_modules']);

function isBacklogFilename(name) {
  return typeof name === 'string' && name.endsWith(BACKLOG_EXTENSION);
}

function isHistoryFilename(name) {
  return typeof name === 'string' && name.endsWith('.history');
}

function isSafeChildPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function resolveCanonicalRepoFile(root, candidate, fieldName) {
  const canonicalRoot = await fs.realpath(root);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${fieldName} must be inside repoPath.`);
  }

  let candidateStats = null;
  try {
    candidateStats = await fs.lstat(candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (candidateStats?.isSymbolicLink()) {
    throw new Error(`${fieldName} must not be a symbolic link.`);
  }

  let canonicalCandidate;
  try {
    canonicalCandidate = await fs.realpath(candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const canonicalParent = await fs.realpath(path.dirname(candidate));
    canonicalCandidate = path.join(canonicalParent, path.basename(candidate));
  }
  if (!isSafeChildPath(canonicalRoot, canonicalCandidate)) {
    throw new Error(`${fieldName} must resolve inside repoPath without a symlink escape.`);
  }
  return candidate;
}

async function resolveBacklogPath(root, backlogPath) {
  const raw = normalizePloinkyPath(normalizeString(backlogPath));
  if (!raw) return '';
  if (raw.startsWith('/.ploinky/')) {
    throw new Error('backlogPath must be an absolute filesystem path inside repoPath, not /.ploinky/...');
  }
  if (!path.isAbsolute(raw)) {
    throw new Error('backlogPath must be an absolute path.');
  }
  const absolute = path.resolve(raw);
  if (!isBacklogFilename(absolute)) {
    throw new Error('backlogPath must end with .backlog.');
  }
  if (!isSafeChildPath(root, absolute)) {
    throw new Error('backlogPath must be inside repoPath.');
  }
  return resolveCanonicalRepoFile(root, absolute, 'backlogPath');
}

async function resolveHistoryPath(root, historyPath) {
  const raw = normalizePloinkyPath(normalizeString(historyPath));
  if (!raw) return '';
  if (raw.startsWith('/.ploinky/')) {
    throw new Error('backlogPath must be an absolute filesystem path inside repoPath, not /.ploinky/...');
  }
  if (!path.isAbsolute(raw)) {
    throw new Error('backlogPath must be an absolute path.');
  }
  const absolute = path.resolve(raw);
  if (!isHistoryFilename(absolute)) {
    throw new Error('backlogPath must end with .history.');
  }
  if (!isSafeChildPath(root, absolute)) {
    throw new Error('backlogPath must be inside repoPath.');
  }
  return resolveCanonicalRepoFile(root, absolute, 'backlogPath');
}

async function listBacklogFiles(root) {
  const results = [];
  const walk = async (current, depth) => {
    if (depth > 12) return;
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (BACKLOG_EXCLUDED_DIRS.has(entry.name)) continue;
        await walk(entryPath, depth + 1);
      } else if (entry.isFile()) {
        if (isBacklogFilename(entry.name)) {
          results.push(entryPath);
        }
      }
    }
  };
  await walk(root, 0);
  return results.sort();
}

async function ensureBacklogFile(backlogPath) {
  if (!backlogPath) return false;
  try {
    await fs.access(backlogPath);
    return true;
  } catch {
    // continue
  }
  try {
    await fs.writeFile(backlogPath, createEmptyBacklogMarkdown(), 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function ensureHistoryFile(historyPath) {
  if (!historyPath) return false;
  try {
    await fs.access(historyPath);
    return true;
  } catch {
    // continue
  }
  try {
    await fs.writeFile(historyPath, createEmptyHistoryMarkdown(), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function getHistoryPathFromBacklog(backlogPath) {
  return String(backlogPath || '').replace(/\.backlog$/i, '.history');
}

async function readMarkdownFile(filePath, { history = false } = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return history ? parseHistoryMarkdown(raw) : parseBacklogMarkdown(raw);
  } catch {
    return [];
  }
}

async function writeBacklogTasks(backlogPath, tasks) {
  await fs.writeFile(backlogPath, serializeBacklogMarkdown(tasks), 'utf8');
}

async function writeHistoryTasks(historyPath, tasks) {
  await fs.writeFile(historyPath, serializeHistoryMarkdown(tasks), 'utf8');
}

async function loadTasks(root, backlogPath = '') {
  const resolved = backlogPath ? await resolveBacklogPath(root, backlogPath) : '';
  if (resolved) {
    const tasks = await readMarkdownFile(resolved);
    return {
      tasks: decorateTasks(tasks, resolved),
      backlogPaths: [resolved],
      files: [{ path: resolved, tasks: decorateTasks(tasks, resolved) }]
    };
  }
  const backlogPaths = await listBacklogFiles(root);
  if (!backlogPaths.length) {
    return { tasks: [], backlogPaths: [], files: [] };
  }
  const tasks = [];
  const files = [];
  for (const filePath of backlogPaths) {
    const fileTasks = await readMarkdownFile(filePath);
    const decorated = decorateTasks(fileTasks, filePath);
    tasks.push(...decorated);
    files.push({ path: filePath, tasks: decorated });
  }
  return { tasks, backlogPaths, files };
}

function decorateTask(task, sourcePath, index) {
  return decorateBacklogTaskRecord(task, sourcePath, index);
}

function decorateTasks(tasks, sourcePath) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map((task, index) => decorateTask(task, sourcePath, index));
}

function decorateHistoryTask(task, sourcePath, index) {
  return decorateHistoryTaskRecord(task, sourcePath, index);
}

function decorateHistoryTasks(tasks, sourcePath) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map((task, index) => decorateHistoryTask(task, sourcePath, index));
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object') return task;
  const rawOptions = Array.isArray(task.options) ? task.options : [];
  const options = rawOptions.map((option) => {
    if (typeof option === 'string') return option;
    if (option === null || typeof option === 'undefined') return '';
    return String(option);
  }).filter((option) => option.trim());
  const resolution = normalizeString(task.resolution);
  return {
    id: normalizeString(task.id).toUpperCase(),
    description: normalizeString(task.description),
    options,
    resolution
  };
}

function findTaskIndexById(tasks, id) {
  const normalizedId = normalizeString(id).toUpperCase();
  if (!normalizedId) return -1;
  return Array.isArray(tasks)
    ? tasks.findIndex((task) => normalizeString(task?.id).toUpperCase() === normalizedId)
    : -1;
}

function matchQuery(task, query) {
  const q = normalizeString(query).toLowerCase();
  if (!q) return true;
  const description = normalizeString(task.description).toLowerCase();
  const resolution = normalizeString(task.resolution).toLowerCase();
  const options = Array.isArray(task.options) ? task.options.join(' ').toLowerCase() : '';
  return description.includes(q) || resolution.includes(q) || options.includes(q);
}

function taskMatchesFilters(task, filters) {
  const status = normalizeString(filters.status);
  if (status && normalizeString(task.status) !== status) return false;
  if (!matchQuery(task, filters.q)) return false;
  return true;
}

async function main() {
  let raw = await fs.readFile(0, 'utf8').catch(() => '');
  if (!raw) {
    raw = await readStdinFallback();
  }
  const envelope = raw && raw.trim() ? safeParseJson(raw) : null;
  const args = normalizeInput(envelope || {});
  const toolName = process.env.TOOL_NAME
    || process.argv[2]
    || envelope?.tool
    || envelope?.params?.name
    || envelope?.params?.tool_name
    || envelope?.name
    || envelope?.tool_name
    || args?.tool_name
    || args?.name;

  if (!toolName) {
    writeJson({ ok: false, error: 'Missing TOOL_NAME.' });
    return;
  }

  const root = getRepoRootFromArgs(args);
  try {
    if (toolName === 'task_config') {
      const config = await loadConfig();
      writeJson({ ok: true, config });
      return;
    }

    const config = await loadConfig();
    const backlogPathRaw = args?.backlogPath ?? args?.backlog_path ?? args?.path ?? '';
    const backlogPathArg = normalizeString(backlogPathRaw);

    if (toolName === 'task_list') {
      const filters = args && typeof args === 'object' ? args : {};
      const { tasks, files } = await loadBacklogIndex(root, backlogPathArg);
      let taskList = tasks;
      if (filters.__debug === true) {
        let fileInfo = {};
        try {
          const debugPath = await resolveBacklogPath(root, backlogPathArg);
          const stat = fsSync.statSync(debugPath);
          fileInfo = {
            exists: true,
            size: Number(stat.size) || 0,
            mtimeMs: Number(stat.mtimeMs) || 0
          };
          const preview = fsSync.readFileSync(debugPath, 'utf8');
          fileInfo.preview = preview.slice(0, 200);
        } catch (error) {
          fileInfo = { exists: false, error: String(error?.message || error) };
        }
        writeJson({
          ok: false,
          error: 'debug',
          debug: {
            argsKeys: Object.keys(filters),
            backlogPathRaw,
            backlogPathArg,
            workspaceRoot: getWorkspaceRoot(),
            repoPath: normalizeString(args?.repoPath),
            backlogFile: fileInfo,
            loadedTaskCount: Array.isArray(taskList) ? taskList.length : null,
            fileCount: Array.isArray(files) ? files.length : null,
            root
          }
        });
        return;
      }
      if (!backlogPathArg) {
        writeJson({ ok: false, error: 'backlogPath is required.' });
        return;
      }
      let filtered = taskList.filter((task) => taskMatchesFilters(task, filters));
      const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : null;
      if (limit && limit > 0) filtered = filtered.slice(0, limit);
      writeJson({ ok: true, tasks: filtered });
      return;
    }

    if (toolName === 'task_history_list') {
      if (!backlogPathArg) {
        writeJson({ ok: false, error: 'backlogPath is required.' });
        return;
      }
      const historyPath = await resolveHistoryPath(root, backlogPathArg);
      const historyTasks = await readMarkdownFile(historyPath, { history: true });
      const decorated = decorateHistoryTasks(historyTasks, historyPath);
      const query = normalizeString(args?.q);
      let filtered = decorated;
      if (query) {
        filtered = decorated.filter((task) => matchQuery(task, query));
      }
      const limit = Number.isFinite(Number(args?.limit)) ? Number(args.limit) : null;
      if (limit && limit > 0) filtered = filtered.slice(0, limit);
      writeJson({ ok: true, tasks: filtered });
      return;
    }

    if (toolName === 'task_get') {
      const id = normalizeString(args?.id);
      if (!id) throw new Error('task_get requires an "id" string.');
      if (!backlogPathArg) {
        writeJson({ ok: false, error: 'backlogPath is required.' });
        return;
      }
      const sourcePath = await resolveBacklogPath(root, backlogPathArg);
      const fileTasks = await readMarkdownFile(sourcePath);
      const index = findTaskIndexById(fileTasks, id);
      if (index < 0) {
        writeJson({ ok: false, error: `Task not found: ${id}` });
        return;
      }
      writeJson({ ok: true, task: decorateTask(fileTasks[index], sourcePath, index) });
      return;
    }

    if (toolName === 'task_create') {
      if (!backlogPathArg) {
        writeJson({ ok: false, error: 'backlogPath is required.' });
        return;
      }
      const description = normalizeString(args?.description);
      if (!description) {
        writeJson({ ok: false, error: 'description is required.' });
        return;
      }
      const rawOptions = Array.isArray(args?.options) ? args.options : [];
      const options = rawOptions.map((option) => {
        if (typeof option === 'string') return option;
        if (option === null || typeof option === 'undefined') return '';
        return String(option);
      }).filter((option) => option.trim());
      const resolution = normalizeString(args?.resolution);
      const task = normalizeTask({
        id: '',
        description,
        options,
        resolution
      });
      const targetPath = await resolveBacklogPath(root, backlogPathArg);
      const historyPath = await resolveHistoryPath(root, getHistoryPathFromBacklog(targetPath));
      await ensureBacklogFile(targetPath);
      await ensureHistoryFile(historyPath);
      const fileTasks = await readMarkdownFile(targetPath);
      const nextTask = normalizeTask({
        ...task,
        id: createNextTaskId(fileTasks)
      });
      fileTasks.push(nextTask);
      await writeBacklogTasks(targetPath, fileTasks);
      writeJson({ ok: true, task: decorateTask(nextTask, targetPath, fileTasks.length - 1) });
      return;
    }

    if (toolName === 'task_update') {
      const id = normalizeString(args?.id);
      if (!id) throw new Error('task_update requires an "id" string.');
      if (!backlogPathArg) {
        writeJson({ ok: false, error: 'backlogPath is required.' });
        return;
      }
      const sourcePath = await resolveBacklogPath(root, backlogPathArg);
      const historyPath = await resolveHistoryPath(root, getHistoryPathFromBacklog(sourcePath));
      await ensureHistoryFile(historyPath);
      const fileTasks = await readMarkdownFile(sourcePath);
      const historyTasks = await readMarkdownFile(historyPath, { history: true });
      const taskIndex = findTaskIndexById(fileTasks, id);
      if (taskIndex < 0) {
        writeJson({ ok: false, error: `Task not found: ${id}` });
        return;
      }
      const task = fileTasks[taskIndex];
      const currentDecorated = decorateTask(task, sourcePath, taskIndex);
      const ifMatch = normalizeString(args?.ifMatch);
      if (ifMatch && ifMatch !== normalizeString(currentDecorated.taskHash) && args?.force !== true) {
        writeJson({
          ok: false,
          error: 'Task conflict detected.',
          data: {
            conflict: {
              current: currentDecorated
            }
          }
        });
        return;
      }
      if (args?.description !== undefined) task.description = normalizeString(args.description);
      if (args?.options !== undefined) {
        const rawOptions = Array.isArray(args.options) ? args.options : [];
        task.options = rawOptions.map((option) => {
          if (typeof option === 'string') return option;
          if (option === null || typeof option === 'undefined') return '';
          return String(option);
        }).filter((option) => option.trim());
      }
      if (args?.resolution !== undefined) task.resolution = normalizeString(args.resolution);
      if (args?.status === 'approved') {
        if (!normalizeString(task.resolution)) {
          writeJson({ ok: false, error: 'Cannot approve without resolution.' });
          return;
        }
        task.options = [];
      }
      if (args?.status === 'done') {
        const resolved = normalizeString(task.resolution);
        const historyTask = normalizeTask({
          id: task.id,
          description: task.description,
          options: [],
          resolution: resolved || 'Executed.'
        });
        historyTasks.push(historyTask);
        fileTasks.splice(taskIndex, 1);
        await writeBacklogTasks(sourcePath, fileTasks);
        await writeHistoryTasks(historyPath, historyTasks);
        writeJson({ ok: true, done: true });
        return;
      }
      fileTasks[taskIndex] = normalizeTask(task);
      await writeBacklogTasks(sourcePath, fileTasks);
      writeJson({ ok: true, task: decorateTask(fileTasks[taskIndex], sourcePath, taskIndex) });
      return;
    }

    if (toolName === 'task_delete') {
      const id = normalizeString(args?.id);
      if (!id) throw new Error('task_delete requires an "id" string.');
      if (!backlogPathArg) {
        writeJson({ ok: false, error: 'backlogPath is required.' });
        return;
      }
      const sourcePath = await resolveBacklogPath(root, backlogPathArg);
      const fileTasks = await readMarkdownFile(sourcePath);
      const index = findTaskIndexById(fileTasks, id);
      if (index < 0) {
        writeJson({ ok: false, error: `Task not found: ${id}` });
        return;
      }
      const next = [...fileTasks];
      next.splice(index, 1);
      await writeBacklogTasks(sourcePath, next);
      writeJson({ ok: true, deleted: id });
      return;
    }

    if (toolName === 'task_reorder') {
      if (!backlogPathArg) {
        writeJson({ ok: false, error: 'backlogPath is required.' });
        return;
      }
      const order = Array.isArray(args?.order) ? args.order : [];
      if (!order.length) {
        writeJson({ ok: false, error: 'order array is required.' });
        return;
      }
      const sourcePath = await resolveBacklogPath(root, backlogPathArg);
      const fileTasks = await readMarkdownFile(sourcePath);
      const byIdMap = new Map(fileTasks.map((task) => [normalizeString(task?.id).toUpperCase(), task]));
      const orderSet = new Set(order.map((rawId) => String(rawId || '').trim().toUpperCase()).filter(Boolean));
      const next = [];
      for (const rawId of order) {
        const id = String(rawId || '').trim().toUpperCase();
        const task = byIdMap.get(id);
        if (task) next.push(task);
      }
      for (const [id, task] of byIdMap.entries()) {
        if (!orderSet.has(id)) next.push(task);
      }
      await writeBacklogTasks(sourcePath, next);
      writeJson({ ok: true, tasks: decorateTasks(next, sourcePath) });
      return;
    }

    writeJson({ ok: false, error: `Unknown tool: ${toolName}` });
  } catch (error) {
    writeJson({ ok: false, error: String(error?.message || error) });
  }
}

main().catch((error) => {
  writeJson({ ok: false, error: String(error?.message || error) });
});
