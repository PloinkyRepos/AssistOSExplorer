import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkspaceRoot(context = {}) {
  const envCandidates = [
    context.workspaceRoot,
    process.env.WORKSPACE_ROOT,
    process.env.ASSISTOS_FS_ROOT,
    process.env.PLOINKY_WORKSPACE_ROOT
  ].filter((value) => typeof value === 'string' && value.trim());

  const baseCandidates = [
    ...envCandidates,
    '/workspace',
    '/code',
    '/Agent',
    '/',
    process.cwd()
  ];

  const checkBase = async (base) => {
    if (!base) return null;
    const repoRoot = path.join(base, '.ploinky', 'repos');
    if (await pathExists(repoRoot)) return base;
    return null;
  };

  for (const base of baseCandidates) {
    const match = await checkBase(base);
    if (match) return match;
  }

  // Fall back to walking up from CWD to find a workspace containing .ploinky/repos.
  let current = process.cwd();
  while (current && current !== path.dirname(current)) {
    const repoRoot = path.join(current, '.ploinky', 'repos');
    if (await pathExists(repoRoot)) {
      return current;
    }
    current = path.dirname(current);
  }

  return envCandidates[0] || process.cwd();
}

async function resolveReposRoot(reposRoot, workspaceRoot) {
  const raw = typeof reposRoot === 'string' ? reposRoot.trim() : '';
  if (!raw) {
    return path.join(workspaceRoot, '.ploinky', 'repos');
  }
  if (path.isAbsolute(raw)) {
    if (await pathExists(raw)) return raw;
    const joined = path.join(workspaceRoot, raw.replace(/^\/+/, ''));
    if (await pathExists(joined)) return joined;
    return raw;
  }
  return path.join(workspaceRoot, raw);
}

let gitBinaryPromise = null;
async function detectGitBinary(cwd) {
  const configured = process.env.ASSISTOS_GIT_BINARY || process.env.GIT_BINARY;
  if (configured) {
    await runGit(cwd, [configured, '--version'], { timeoutMs: 5000 });
    return configured;
  }
  const candidates = [
    'git',
    '/usr/bin/git',
    '/bin/git',
    '/usr/local/bin/git',
    '/opt/homebrew/bin/git'
  ];
  for (const candidate of candidates) {
    try {
      await runGit(cwd, [candidate, '--version'], { timeoutMs: 5000 });
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('Git executable not found. Install git or set ASSISTOS_GIT_BINARY.');
}

async function getGitBinary(cwd) {
  if (!gitBinaryPromise) {
    gitBinaryPromise = detectGitBinary(cwd);
  }
  return gitBinaryPromise;
}

async function runGit(cwd, args, { timeoutMs = 20000, okCodes = [0], input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT || '0',
        GIT_OPTIONAL_LOCKS: process.env.GIT_OPTIONAL_LOCKS || '0',
        GIT_DISCOVERY_ACROSS_FILESYSTEM: process.env.GIT_DISCOVERY_ACROSS_FILESYSTEM || '1'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const abortTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`git timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    if (input !== null && input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(abortTimer);
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        reject(new Error('Git executable not found (spawn ENOENT). Install git or set ASSISTOS_GIT_BINARY.'));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(abortTimer);
      if ((okCodes || [0]).includes(code)) {
        resolve({ stdout, stderr });
        return;
      }
      const msg = stderr.trim() || stdout.trim() || `git exited with code ${code}`;
      reject(new Error(msg));
    });
  });
}

function parseStatusPorcelainV1Z(output) {
  const entries = [];
  const tokens = output.split('\0').filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.length < 3) continue;
    const x = token[0];
    const y = token[1];
    const rawPath = token.slice(3);
    const isRenameOrCopy = x === 'R' || x === 'C' || y === 'R' || y === 'C';
    if (isRenameOrCopy) {
      const oldPath = rawPath;
      const newPath = tokens[i + 1];
      i += 1;
      if (newPath) {
        entries.push({ path: newPath, x, y, origPath: oldPath });
      }
      continue;
    }
    entries.push({ path: rawPath, x, y });
  }
  return entries;
}

function categorizeStatusEntries(entries) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  const conflicted = [];
  for (const entry of entries) {
    const xy = `${entry.x}${entry.y}`;
    if (xy === '??') {
      untracked.push(entry);
      continue;
    }
    if (xy.includes('U') || xy === 'AA' || xy === 'DD') {
      conflicted.push(entry);
      continue;
    }
    if (entry.x && entry.x !== ' ') staged.push(entry);
    if (entry.y && entry.y !== ' ') unstaged.push(entry);
  }
  return { staged, unstaged, untracked, conflicted };
}

function normalizeErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || 'Unknown error';
  return String(error);
}

function isGitConflictError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('conflict') || text.includes('unmerged') || text.includes('automatic merge failed');
}

function isGitPullBlockedError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('would be overwritten by merge')
    || text.includes('would be overwritten by checkout')
    || text.includes('please commit your changes or stash them')
    || text.includes('cannot pull with rebase')
    || text.includes('you have unstaged changes');
}

function toBasicAuthHeader({ username, token }) {
  const user = String(username || 'x-access-token');
  const pass = String(token || '');
  const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Authorization: Basic ${encoded}`;
}

async function getRemoteForAuth(repoPath, gitBinary) {
  try {
    const { stdout } = await runGit(repoPath, [gitBinary, 'config', '--get', 'remote.pushDefault'], { timeoutMs: 5000 });
    const v = (stdout || '').trim();
    if (v) return v;
  } catch {}
  try {
    const { stdout } = await runGit(repoPath, [gitBinary, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 5000 });
    const upstream = (stdout || '').trim();
    if (upstream && upstream.includes('/')) return upstream.split('/')[0];
  } catch {}
  return null;
}

async function getRemoteUrl(repoPath, gitBinary, remote, forPush) {
  if (forPush) {
    try {
      const { stdout } = await runGit(repoPath, [gitBinary, 'remote', 'get-url', '--push', remote], { timeoutMs: 5000 });
      const url = (stdout || '').trim();
      if (url) return url;
    } catch {}
  }
  try {
    const { stdout } = await runGit(repoPath, [gitBinary, 'remote', 'get-url', remote], { timeoutMs: 5000 });
    return (stdout || '').trim();
  } catch {
    return '';
  }
}

async function buildAuthHeader(repoPath, gitBinary, token, forPush) {
  const cleanToken = token ? String(token).trim() : '';
  if (!cleanToken) return null;
  const remote = (await getRemoteForAuth(repoPath, gitBinary)) || 'origin';
  const remoteUrl = await getRemoteUrl(repoPath, gitBinary, remote, forPush);
  const isHttp = remoteUrl.startsWith('http://') || remoteUrl.startsWith('https://');
  if (!isHttp) {
    throw new Error('Remote is not HTTPS; token auth is only supported for HTTPS remotes.');
  }
  return toBasicAuthHeader({ username: 'x-access-token', token: cleanToken });
}

async function listRepos(reposRoot) {
  let entries = [];
  try {
    entries = await fs.readdir(reposRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(reposRoot, entry.name);
    try {
      const gitBinary = await getGitBinary(repoPath);
      const { stdout } = await runGit(repoPath, [gitBinary, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 5000 });
      if (stdout.trim().startsWith('true')) {
        repos.push(repoPath);
      }
    } catch {
      continue;
    }
  }
  return repos;
}

function normalizeRequestedRepos(requested, reposRoot) {
  const list = Array.isArray(requested) ? requested : [];
  const normalizedPaths = new Set();
  const normalizedNames = new Set();
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry.trim() : '';
    if (!raw) continue;
    const baseName = path.basename(raw);
    if (baseName) normalizedNames.add(baseName);
    if (path.isAbsolute(raw)) {
      normalizedPaths.add(path.normalize(raw));
      continue;
    }
    if (!reposRoot) continue;
    const relative = raw.replace(/^\.\/+/, '');
    normalizedPaths.add(path.normalize(path.join(reposRoot, relative)));
  }
  return { normalizedPaths, normalizedNames };
}

function buildRequestedRepoList(requested, reposRoot) {
  const list = Array.isArray(requested) ? requested : [];
  const candidates = new Set();
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry.trim() : '';
    if (!raw) continue;
    if (path.isAbsolute(raw)) {
      candidates.add(path.normalize(raw));
      continue;
    }
    if (!reposRoot) continue;
    const relative = raw.replace(/^\.\/+/, '');
    candidates.add(path.normalize(path.join(reposRoot, relative)));
  }
  return Array.from(candidates);
}

async function resolveRequestedRepos(requested, reposRoot) {
  const list = Array.isArray(requested) ? requested : [];
  const candidates = new Set();
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry.trim() : '';
    if (!raw) continue;
    if (path.isAbsolute(raw)) {
      candidates.add(path.normalize(raw));
      continue;
    }
    if (!reposRoot) continue;
    const relative = raw.replace(/^\.\/+/, '');
    candidates.add(path.normalize(path.join(reposRoot, relative)));
  }

  const valid = [];
  for (const repoPath of candidates) {
    try {
      const gitDir = path.join(repoPath, '.git');
      if (await pathExists(gitDir)) {
        valid.push(repoPath);
        continue;
      }
      const gitBinary = await getGitBinary(repoPath);
      const { stdout } = await runGit(repoPath, [gitBinary, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 5000 });
      if (stdout.trim().startsWith('true')) {
        valid.push(repoPath);
      }
    } catch {
      // fallback to path existence in case git binary is unavailable in this context
      if (await pathExists(repoPath)) {
        valid.push(repoPath);
      }
      continue;
    }
  }
  return valid;
}

async function getRepoStatus(repoPath) {
  const gitBinary = await getGitBinary(repoPath);
  const { stdout } = await runGit(repoPath, [gitBinary, 'status', '--porcelain=v1', '-z']);
  const entries = parseStatusPorcelainV1Z(stdout || '');
  return categorizeStatusEntries(entries);
}

async function stageAll(repoPath) {
  const gitBinary = await getGitBinary(repoPath);
  await runGit(repoPath, [gitBinary, 'add', '-A'], { timeoutMs: 30000 });
}

async function commit(repoPath, message) {
  const gitBinary = await getGitBinary(repoPath);
  const msg = String(message || '').trim() || 'chore: autocommit';
  await runGit(repoPath, [gitBinary, 'commit', '-m', msg], { timeoutMs: 60000 });
}

async function pull(repoPath, token) {
  const gitBinary = await getGitBinary(repoPath);
  const extraHeader = await buildAuthHeader(repoPath, gitBinary, token, false);
  const args = [gitBinary];
  if (extraHeader) args.push('-c', `http.extraHeader=${extraHeader}`);
  args.push('pull', '--ff-only');
  await runGit(repoPath, args, { timeoutMs: 180000 });
}

async function push(repoPath, token) {
  const gitBinary = await getGitBinary(repoPath);
  const extraHeader = await buildAuthHeader(repoPath, gitBinary, token, true);
  const args = [gitBinary];
  if (extraHeader) args.push('-c', `http.extraHeader=${extraHeader}`);
  args.push('push');
  await runGit(repoPath, args, { timeoutMs: 120000 });
}

async function stash(repoPath) {
  const gitBinary = await getGitBinary(repoPath);
  const { stdout, stderr } = await runGit(repoPath, [gitBinary, 'stash', 'push', '--include-untracked', '-m', 'Autocommit: auto-stash before pull'], { timeoutMs: 30000 });
  const output = `${stdout}\n${stderr}`.trim();
  const lower = output.toLowerCase();
  const created = !lower.includes('no local changes');
  const refMatch = output.match(/stash@\{\d+\}/);
  return { created, ref: refMatch ? refMatch[0] : null };
}

async function stashPop(repoPath, ref) {
  const gitBinary = await getGitBinary(repoPath);
  const args = [gitBinary, 'stash', 'pop', '--index'];
  if (ref) args.push(ref);
  const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 30000, okCodes: [0, 1] });
  const output = `${stdout}\n${stderr}`.trim();
  const lower = output.toLowerCase();
  const conflicts = lower.includes('conflict') || lower.includes('unmerged');
  return { conflicts, output };
}

async function pullWithAutoStash(repoPath, token) {
  try {
    await pull(repoPath, token);
    return;
  } catch (error) {
    const msg = normalizeErrorMessage(error);
    if (isGitConflictError(msg)) {
      throw new Error(msg);
    }
    if (!isGitPullBlockedError(msg)) {
      throw new Error(msg);
    }
    const stashResult = await stash(repoPath);
    if (!stashResult.created) {
      throw new Error(msg);
    }
    await pull(repoPath, token);
    const popResult = await stashPop(repoPath, stashResult.ref || null);
    if (popResult.conflicts) {
      throw new Error('Conflicts after restoring stashed changes. Resolve them before continuing.');
    }
  }
}

export default async function gitAutocommit(input, context = {}) {
  let payload = input;
  if (typeof payload === 'string') {
    const parsed = safeParseJson(payload.trim());
    if (parsed) payload = parsed;
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid input. Expected an object payload.');
  }

  const workspaceRoot = await resolveWorkspaceRoot(context);
  const reposRoot = await resolveReposRoot(payload.reposRoot, workspaceRoot);
  const token = payload.token ? String(payload.token) : '';
  const message = payload.message ? String(payload.message) : 'chore: autocommit';
  const requestedRepos = payload.repos;

  let repos = [];
  let selectedRepos = [];
  const { normalizedPaths, normalizedNames } = normalizeRequestedRepos(requestedRepos, reposRoot);
  const hasSelection = normalizedPaths.size > 0 || normalizedNames.size > 0;

  if (hasSelection) {
    selectedRepos = buildRequestedRepoList(requestedRepos, reposRoot);
    if (!selectedRepos.length) {
      selectedRepos = await resolveRequestedRepos(requestedRepos, reposRoot);
    }
  } else {
    repos = await listRepos(reposRoot);
    selectedRepos = repos;
  }

  if (hasSelection && selectedRepos.length) {
    // Allow explicit selections to run without filtering to listRepos.
    repos = selectedRepos;
  } else if (!hasSelection) {
    repos = selectedRepos;
  }
  if (!selectedRepos.length) {
    return JSON.stringify({
      ok: true,
      stopped: false,
      conflicts: false,
      message: hasSelection ? 'No selected git repositories found for autocommit.' : 'No git repositories found for autocommit.'
    });
  }

  let processed = 0;
  for (const repoPath of selectedRepos) {
    processed += 1;
    try {
      await pullWithAutoStash(repoPath, token);
    } catch (error) {
      const msg = normalizeErrorMessage(error);
      return JSON.stringify({
        ok: false,
        stopped: true,
        conflicts: isGitConflictError(msg),
        message: msg,
        repoPath,
        reposProcessed: processed
      });
    }

    let status = null;
    try {
      status = await getRepoStatus(repoPath);
    } catch {
      continue;
    }

    if (status.conflicted.length > 0) {
      return JSON.stringify({
        ok: false,
        stopped: true,
        conflicts: true,
        message: 'Merge conflicts detected.',
        repoPath,
        reposProcessed: processed
      });
    }

    const hasChanges = status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0;
    if (!hasChanges) {
      continue;
    }

    await stageAll(repoPath);

    const afterStage = await getRepoStatus(repoPath);
    if (afterStage.conflicted.length > 0) {
      return JSON.stringify({
        ok: false,
        stopped: true,
        conflicts: true,
        message: 'Merge conflicts detected.',
        repoPath,
        reposProcessed: processed
      });
    }
    if (afterStage.staged.length === 0) {
      continue;
    }

    try {
      await commit(repoPath, message);
    } catch (error) {
      return JSON.stringify({
        ok: false,
        stopped: true,
        conflicts: false,
        message: normalizeErrorMessage(error),
        repoPath,
        reposProcessed: processed
      });
    }

    try {
      await push(repoPath, token);
    } catch (error) {
      return JSON.stringify({
        ok: false,
        stopped: true,
        conflicts: false,
        message: normalizeErrorMessage(error),
        repoPath,
        reposProcessed: processed
      });
    }
  }

  return JSON.stringify({
    ok: true,
    stopped: false,
    conflicts: false,
    message: '',
    reposProcessed: processed
  });
}
