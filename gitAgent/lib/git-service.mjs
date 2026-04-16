import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || 'Unknown error';
  return String(error);
}

function isGitRepoRelativePath(candidate) {
  if (typeof candidate !== 'string') return false;
  if (!candidate.trim()) return false;
  if (candidate.includes('\0')) return false;
  if (path.isAbsolute(candidate)) return false;
  const normalized = candidate.replaceAll('\\', '/');
  if (normalized.startsWith('../') || normalized === '..') return false;
  if (normalized.includes('/../')) return false;
  return true;
}

function normalizeGitRepoRelativePath(candidate) {
  return String(candidate || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/g, '');
}

function normalizeGitIgnorePattern(candidate, { directory = false } = {}) {
  const normalized = normalizeGitRepoRelativePath(candidate);
  if (!normalized) return '';
  return directory ? `${normalized}/` : normalized;
}

function normalizeRepositoryName(candidate) {
  const value = String(candidate || '').trim();
  if (!value) {
    throw new Error('Repository name is required.');
  }
  if (value.includes('\0')) {
    throw new Error('Invalid repository name.');
  }
  if (value === '.' || value === '..') {
    throw new Error('Invalid repository name.');
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error('Repository name must not include path separators.');
  }
  return value;
}

function isPathWithinIgnoredPath(candidate, ignoredPath) {
  const normalizedCandidate = normalizeGitRepoRelativePath(candidate);
  const normalizedIgnored = normalizeGitRepoRelativePath(ignoredPath);
  if (!normalizedCandidate || !normalizedIgnored) return false;
  return normalizedCandidate === normalizedIgnored || normalizedCandidate.startsWith(`${normalizedIgnored}/`);
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
        reject(new Error('Git executable not found (spawn ENOENT). Install git or set ASSISTOS_GIT_BINARY to the full path of the git binary.'));
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
      if (msg.includes('not a git repository')) {
        reject(new Error('Not a git repository. Set the repo path to a folder inside a git repo (or the repo root).'));
        return;
      }
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
  const ignored = [];

  for (const entry of entries) {
    const xy = `${entry.x}${entry.y}`;
    if (xy === '!!') {
      ignored.push(entry);
      continue;
    }
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

  const sortByPath = (a, b) => String(a.path).localeCompare(String(b.path));
  staged.sort(sortByPath);
  unstaged.sort(sortByPath);
  untracked.sort(sortByPath);
  conflicted.sort(sortByPath);
  ignored.sort(sortByPath);
  return { staged, unstaged, untracked, conflicted, ignored };
}

function getStopTrackingIgnoredPaths(status = {}) {
  const stagedDeletes = new Set(
    (Array.isArray(status.staged) ? status.staged : [])
      .filter((entry) => entry?.path && (entry.x === 'D' || entry.y === 'D'))
      .map((entry) => entry.path)
  );
  const ignoredPaths = new Set(
    (Array.isArray(status.ignored) ? status.ignored : [])
      .filter((entry) => entry?.path)
      .map((entry) => entry.path)
  );
  return Array.from(stagedDeletes).filter((file) => ignoredPaths.has(file)).sort((a, b) => a.localeCompare(b));
}

const DEFAULT_STASH_EXCLUDED_DIRS = Object.freeze([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
  'logs',
  'blobs',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.mcp-cache'
]);

function isExcludedStashTarget(candidate) {
  const normalized = normalizeGitRepoRelativePath(candidate);
  if (!normalized) return false;
  const segments = normalized.split('/').filter(Boolean);
  return segments.some((segment) => DEFAULT_STASH_EXCLUDED_DIRS.includes(segment));
}

function getStashTargetPaths(status = {}, { includeIgnoredStopTracking = false } = {}) {
  const targets = new Set();
  const stopTrackingIgnored = new Set(getStopTrackingIgnoredPaths(status));
  for (const bucket of ['staged', 'unstaged', 'untracked', 'conflicted']) {
    for (const entry of (Array.isArray(status?.[bucket]) ? status[bucket] : [])) {
      const candidate = normalizeGitRepoRelativePath(entry?.path);
      if (candidate && !stopTrackingIgnored.has(candidate)) {
        targets.add(candidate);
      }
    }
  }
  if (includeIgnoredStopTracking) {
    for (const candidate of getStopTrackingIgnoredPaths(status)) {
      const normalized = normalizeGitRepoRelativePath(candidate);
      if (normalized) {
        targets.add(normalized);
      }
    }
  }
  return Array.from(targets)
    .filter((candidate) => !isExcludedStashTarget(candidate))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function extractConflictPathsFromOutput(output) {
  const text = String(output || '');
  if (!text.trim()) return [];
  const matches = new Set();
  const patterns = [
    /CONFLICT \([^)]+\): .*? in (.+)$/gim,
    /^([^:\n]+): needs merge$/gim,
    /^UU\s+(.+)$/gim,
    /^AA\s+(.+)$/gim,
    /^DD\s+(.+)$/gim,
    /^DU\s+(.+)$/gim,
    /^UD\s+(.+)$/gim,
    /^AU\s+(.+)$/gim,
    /^UA\s+(.+)$/gim,
    /^both modified:\s+(.+)$/gim,
    /^both added:\s+(.+)$/gim,
    /^both deleted:\s+(.+)$/gim,
    /^deleted by us:\s+(.+)$/gim,
    /^deleted by them:\s+(.+)$/gim,
    /^added by us:\s+(.+)$/gim,
    /^added by them:\s+(.+)$/gim
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = String(match[1] || '').trim();
      if (!candidate) continue;
      matches.add(candidate.replace(/^["']|["']$/g, ''));
    }
  }
  return Array.from(matches).sort((a, b) => a.localeCompare(b));
}

function hasGitConflictOutput(output) {
  const text = String(output || '');
  if (!text.trim()) return false;
  return /(^|\n)(CONFLICT \(|UU\s|AA\s|DD\s|DU\s|UD\s|AU\s|UA\s|both modified:|both added:|both deleted:|deleted by us:|deleted by them:|added by us:|added by them:|[^:\n]+: needs merge$)/im.test(text)
    || /\bunmerged\b/i.test(text);
}

async function listUnmergedPaths(repoPath, gitBinary) {
  try {
    const { stdout } = await runGit(repoPath, [gitBinary, 'diff', '--name-only', '--diff-filter=U'], {
      timeoutMs: 10000
    });
    return stdout
      .split(/\r?\n/)
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function normalizeGitConfigValue(value) {
  if (value === undefined || value === null) return '';
  const v = String(value).trim();
  if (v.includes('\0') || v.includes('\n') || v.includes('\r')) {
    throw new Error('Invalid git config value (contains control characters).');
  }
  if (v.length > 200) {
    throw new Error('Invalid git config value (too long).');
  }
  return v;
}

function toBasicAuthHeader({ username, token }) {
  const user = String(username || 'x-access-token');
  const pass = String(token || '');
  const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Authorization: Basic ${encoded}`;
}

function isGithubHttpsRemote(remoteUrl) {
  const value = String(remoteUrl || '').trim().toLowerCase();
  return value.startsWith('https://github.com/') || value.startsWith('http://github.com/');
}

function getGithubAccessTokenFromMeta(meta) {
  const directMeta = meta && typeof meta === 'object' ? meta : null;
  const nestedMeta = directMeta && directMeta.params && typeof directMeta.params === 'object'
    ? (directMeta.params._meta && typeof directMeta.params._meta === 'object' ? directMeta.params._meta : null)
    : null;
  const resolvedMeta = directMeta?.auth ? directMeta : nestedMeta;
  const auth = resolvedMeta && typeof resolvedMeta === 'object' ? resolvedMeta.auth : null;
  const github = auth && typeof auth === 'object' ? auth.github : null;
  if (!github || typeof github !== 'object') return '';
  if (String(github.provider || '').trim().toLowerCase() !== 'github') return '';
  return String(github.accessToken || '').trim();
}

export function createGitService({ validatePath }) {
  let gitBinaryPromise = null;
  let gitBinaryCwd = null;

  async function detectGitBinary(cwd) {
    // Use a known-good directory for binary detection. The user-provided cwd
    // may not exist yet, and spawn() throws ENOENT for both "binary not found"
    // and "cwd not found", making it impossible to distinguish the two cases.
    const probeCwd = '/tmp';
    const configured = process.env.ASSISTOS_GIT_BINARY || process.env.GIT_BINARY;
    if (configured) {
      await runGit(probeCwd, [configured, '--version'], { timeoutMs: 5000 });
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
        await runGit(probeCwd, [candidate, '--version'], { timeoutMs: 5000 });
        return candidate;
      } catch {
        continue;
      }
    }

    throw new Error('Git executable not found. Install git or set ASSISTOS_GIT_BINARY to the full path of the git binary.');
  }

  async function getGitBinary(cwd) {
    if (!gitBinaryPromise || (gitBinaryCwd && gitBinaryCwd !== cwd)) {
      gitBinaryCwd = cwd;
      gitBinaryPromise = detectGitBinary(cwd);
    }
    return gitBinaryPromise;
  }

  async function resolveRepoPath(repoPathArg) {
    const repoPath = await validatePath(repoPathArg || '/');
    return repoPath;
  }

  async function resolveRepoWorkTreePath(repoPathArg) {
    const context = await resolveGitTargetContext(repoPathArg);
    return context.repoPath;
  }

  async function resolveGitTargetContext(targetPathArg) {
    const validatedTargetPath = await validatePath(targetPathArg || '/');
    const targetPath = await fs.realpath(validatedTargetPath);
    const stats = await fs.lstat(targetPath);
    const probePath = stats.isDirectory() ? targetPath : path.dirname(targetPath);
    const gitBinary = await getGitBinary(probePath);
    const { stdout } = await runGit(probePath, [gitBinary, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 });
    const repoPathRaw = String(stdout || '').trim();
    const repoPath = repoPathRaw ? await fs.realpath(repoPathRaw) : '';
    if (!repoPath) {
      throw new Error('Not a git repository. Set the path to a file or folder inside a git repository.');
    }
    const relativePath = path.relative(repoPath, targetPath).split(path.sep).join('/');
    if (targetPath !== repoPath && (!relativePath || relativePath.startsWith('..'))) {
      throw new Error('Target path must be inside the git repository.');
    }
    return {
      targetPath,
      probePath,
      repoPath,
      gitBinary,
      stats,
      repoRelativePath: relativePath && relativePath !== '.' ? normalizeGitRepoRelativePath(relativePath) : ''
    };
  }


  async function gitInfo({ path: repoPathArg }) {
    let context = null;
    try {
      context = await resolveGitTargetContext(repoPathArg);
      const inside = await runGit(context.probePath, [context.gitBinary, 'rev-parse', '--is-inside-work-tree']);
      if (!inside.stdout.trim().startsWith('true')) {
        return { ok: false, branch: null, upstream: null, remotes: [], repoPath: null, repoRelativePath: '' };
      }
    } catch {
      return { ok: false, branch: null, upstream: null, remotes: [], repoPath: null, repoRelativePath: '' };
    }

    let branch = null;
    let upstream = null;
    let remotes = [];
    try {
      const res = await runGit(context.probePath, [context.gitBinary, 'rev-parse', '--abbrev-ref', 'HEAD']);
      branch = res.stdout.trim() || null;
    } catch {
      branch = null;
    }
    try {
      const res = await runGit(context.probePath, [context.gitBinary, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
      upstream = res.stdout.trim() || null;
    } catch {
      upstream = null;
    }
    try {
      const res = await runGit(context.probePath, [context.gitBinary, 'remote']);
      remotes = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch {
      remotes = [];
    }
    return {
      ok: true,
      branch,
      upstream,
      remotes,
      repoPath: context.repoPath,
      repoRelativePath: context.repoRelativePath
    };
  }

  async function gitInitRepository({ path: parentPathArg, name }) {
    const validatedParentPath = await validatePath(parentPathArg || '/');
    const parentPath = await fs.realpath(validatedParentPath);
    const parentStats = await fs.lstat(parentPath);
    if (!parentStats.isDirectory()) {
      throw new Error('Repository parent path must be a directory.');
    }

    const repoName = normalizeRepositoryName(name);
    const targetPath = path.join(parentPath, repoName);
    await validatePath(targetPath);

    try {
      await fs.lstat(targetPath);
      throw new Error(`Repository directory already exists: ${repoName}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.mkdir(targetPath, { recursive: false });
    const gitBinary = await getGitBinary(parentPath);
    try {
      await runGit(targetPath, [gitBinary, 'init'], { timeoutMs: 20000 });
    } catch (error) {
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    const repoPath = await fs.realpath(targetPath);
    return {
      ok: true,
      parentPath,
      repoPath,
      name: repoName
    };
  }

  async function gitStatus({ path: repoPathArg, includeAhead = false }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const { stdout } = await runGit(repoPath, [gitBinary, 'status', '--porcelain=v1', '-z', '-uall', '--ignored=matching']);
    const entries = parseStatusPorcelainV1Z(stdout);
    const status = categorizeStatusEntries(entries);
    if (!includeAhead) {
      return { ok: true, status };
    }
    let branch = null;
    let upstream = null;
    let ahead = null;
    let behind = null;
    try {
      const { stdout: branchOut } = await runGit(repoPath, [gitBinary, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 });
      branch = String(branchOut || '').trim() || null;
    } catch {
      branch = null;
    }
    try {
      const { stdout: upstreamOut } = await runGit(repoPath, [gitBinary, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 5000 });
      upstream = String(upstreamOut || '').trim() || null;
    } catch {
      upstream = null;
    }
    if (upstream) {
      try {
        const { stdout: countsOut } = await runGit(repoPath, [gitBinary, 'rev-list', '--left-right', '--count', `${upstream}...HEAD`], { timeoutMs: 5000 });
        const [behindRaw, aheadRaw] = String(countsOut || '').trim().split(/\s+/);
        const behindNum = Number(behindRaw);
        const aheadNum = Number(aheadRaw);
        if (Number.isFinite(aheadNum)) ahead = aheadNum;
        if (Number.isFinite(behindNum)) behind = behindNum;
      } catch {
        ahead = null;
        behind = null;
      }
    }
    return { ok: true, status, branch, upstream, ahead, behind };
  }

  async function gitStatusOverview({ path: repoPathArg, includeUntracked = false }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const untrackedFlag = includeUntracked ? '-uall' : '-uno';
    const { stdout } = await runGit(
      repoPath,
      // `--no-optional-locks` is a global git option (must be before the subcommand).
      [
        gitBinary,
        '--no-optional-locks',
        'status',
        '--porcelain=v1',
        '-z',
        untrackedFlag,
        ...(includeUntracked ? ['--ignored=matching'] : [])
      ],
      { timeoutMs: 5000 }
    );
    const entries = parseStatusPorcelainV1Z(stdout);
    const status = categorizeStatusEntries(entries);
    if (!includeUntracked) {
      status.untracked = [];
      status.ignored = [];
    }
    return { ok: true, status };
  }

  async function gitDiff({ path: repoPathArg, file, cached = false, ref = null }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    if (!isGitRepoRelativePath(file)) {
      throw new Error(`Invalid file path for git_diff: ${file}`);
    }
    const gitBinary = await getGitBinary(repoPath);
    const baseRef = ref && typeof ref === 'string' && ref.trim() ? ref.trim() : null;

    // Default behavior (backwards compatible).
    if (!baseRef) {
      const args = cached ? [gitBinary, 'diff', '--cached', '--', file] : [gitBinary, 'diff', '--', file];
      const { stdout } = await runGit(repoPath, args, { timeoutMs: 25000 });
      return stdout;
    }

    // WebStorm-like behavior: show a diff against baseRef (ex: HEAD) even if the change is staged-only.
    // 1) working tree vs baseRef
    // 2) index vs baseRef (staged-only)
    // 3) untracked fallback via `--no-index` ("added file" diff)
    const { stdout } = await runGit(repoPath, [gitBinary, 'diff', baseRef, '--', file], { timeoutMs: 25000 });
    if (stdout && stdout.trim()) return stdout;
    try {
      const { stdout: cachedStdout } = await runGit(
        repoPath,
        [gitBinary, 'diff', '--cached', baseRef, '--', file],
        { timeoutMs: 25000 }
      );
      if (cachedStdout && cachedStdout.trim()) return cachedStdout;
    } catch {
      // ignore
    }
    try {
      const { stdout: noIndex } = await runGit(
        repoPath,
        [gitBinary, 'diff', '--no-index', '--', '/dev/null', file],
        // `git diff --no-index` returns exit code 1 when differences are found (expected for new files).
        { timeoutMs: 25000, okCodes: [0, 1] }
      );
      return noIndex;
    } catch {
      return '';
    }
  }

  async function gitStage({ path: repoPathArg, files = [] }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      await runGit(repoPath, [gitBinary, 'add', '-A']);
      return { ok: true };
    }
    for (const file of list) {
      if (!isGitRepoRelativePath(file)) throw new Error(`Invalid file path for git_stage: ${file}`);
    }
    const existing = [];
    const missing = [];
    for (const file of list) {
      try {
        await fs.stat(path.join(repoPath, file));
        existing.push(file);
      } catch {
        missing.push(file);
      }
    }
    let addable = existing;
    if (existing.length) {
      try {
        const [ignorePayload, statusPayload] = await Promise.all([
          gitCheckIgnore({ path: repoPath, files: existing }),
          gitStatus({ path: repoPath }).catch(() => null)
        ]);
        const ignoredSet = new Set();
        for (const entry of (Array.isArray(ignorePayload?.matches) ? ignorePayload.matches : [])) {
          const normalized = normalizeGitRepoRelativePath(entry?.path);
          if (normalized) ignoredSet.add(normalized);
        }
        const status = statusPayload?.status || statusPayload || {};
        for (const entry of (Array.isArray(status?.ignored) ? status.ignored : [])) {
          const normalized = normalizeGitRepoRelativePath(entry?.path);
          if (normalized) ignoredSet.add(normalized);
        }
        if (ignoredSet.size) {
          addable = existing.filter((file) => {
            const normalized = normalizeGitRepoRelativePath(file);
            if (!normalized) return false;
            for (const ignoredPath of ignoredSet.values()) {
              if (isPathWithinIgnoredPath(normalized, ignoredPath)) {
                return false;
              }
            }
            return true;
          });
        }
      } catch {
        addable = existing;
      }
    }
    if (addable.length) {
      await runGit(repoPath, [gitBinary, 'add', '-A', '--', ...addable]);
    }
    if (missing.length) {
      await runGit(repoPath, [gitBinary, 'rm', '--cached', '--ignore-unmatch', '--', ...missing]);
    }
    return { ok: true };
  }

  async function gitStageExact({ path: repoPathArg, files = [] }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const list = Array.isArray(files) ? files : [];
    for (const file of list) {
      if (!isGitRepoRelativePath(file)) throw new Error(`Invalid file path for git_stage_exact: ${file}`);
    }

    const statusPayload = list.length ? await gitStatus({ path: repoPath }) : null;
    const status = statusPayload?.status || statusPayload || {};
    const stopTrackingIgnoredSet = new Set(getStopTrackingIgnoredPaths(status));
    const stopTrackingIgnored = list.filter((file) => stopTrackingIgnoredSet.has(file));
    const normalFiles = list.filter((file) => !stopTrackingIgnoredSet.has(file));

    try {
      await runGit(repoPath, [gitBinary, 'restore', '--staged', '--', '.']);
    } catch {
      await runGit(repoPath, [gitBinary, 'reset', '-q', 'HEAD', '--', '.']);
    }

    if (!list.length) {
      return { ok: true };
    }

    if (normalFiles.length) {
      await gitStage({ path: repoPath, files: normalFiles });
    }
    if (stopTrackingIgnored.length) {
      await gitUntrack({ path: repoPath, files: stopTrackingIgnored });
    }
    return { ok: true };
  }

  async function gitUnstage({ path: repoPathArg, files = [] }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      try {
        await runGit(repoPath, [gitBinary, 'restore', '--staged', '--', '.']);
        return { ok: true };
      } catch {
        await runGit(repoPath, [gitBinary, 'reset', '-q', 'HEAD', '--', '.']);
        return { ok: true };
      }
    }
    for (const file of list) {
      if (!isGitRepoRelativePath(file)) throw new Error(`Invalid file path for git_unstage: ${file}`);
    }
    try {
      await runGit(repoPath, [gitBinary, 'restore', '--staged', '--', ...list]);
    } catch {
      await runGit(repoPath, [gitBinary, 'reset', '-q', 'HEAD', '--', ...list]);
    }
    return { ok: true };
  }

  async function gitUntrack({ path: repoPathArg, files = [] }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      throw new Error('git_untrack requires at least one file path.');
    }
    for (const file of list) {
      if (!isGitRepoRelativePath(file)) throw new Error(`Invalid file path for git_untrack: ${file}`);
    }
    await runGit(repoPath, [gitBinary, 'rm', '--cached', '--', ...list], { timeoutMs: 25000 });
    return { ok: true };
  }

  async function gitCheckIgnore({ path: repoPathArg, files = [] }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      throw new Error('git_check_ignore requires at least one file path.');
    }
    for (const file of list) {
      if (!isGitRepoRelativePath(file)) throw new Error(`Invalid file path for git_check_ignore: ${file}`);
    }
    const input = `${list.join('\0')}\0`;
    const { stdout } = await runGit(
      repoPath,
      [gitBinary, 'check-ignore', '-v', '-z', '--stdin'],
      { timeoutMs: 5000, okCodes: [0, 1], input }
    );
    const records = stdout ? stdout.split('\0') : [];
    const matches = [];
    for (let i = 0; i + 3 < records.length; i += 4) {
      const source = records[i];
      const lineRaw = records[i + 1];
      const pattern = records[i + 2];
      const pathValue = records[i + 3];
      if (!source || !pathValue) continue;
      const line = Number.parseInt(lineRaw, 10);
      matches.push({
        source,
        line: Number.isFinite(line) ? line : null,
        pattern,
        path: pathValue
      });
    }
    return { ok: true, matches };
  }

  async function gitAddIgnore({ path: targetPathArg }) {
    const context = await resolveGitTargetContext(targetPathArg);
    const pattern = normalizeGitIgnorePattern(context.repoRelativePath, { directory: context.stats.isDirectory() });
    if (!pattern) {
      throw new Error('Could not derive a valid .gitignore pattern for the selected path.');
    }

    const repoRelativeTarget = context.repoRelativePath;
    const ignoreFilePath = path.join(context.repoPath, '.gitignore');
    let currentContent = '';
    try {
      currentContent = await fs.readFile(ignoreFilePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    const existingPatterns = new Set(
      String(currentContent || '')
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
    const alreadyPresent = existingPatterns.has(pattern);

    if (!alreadyPresent) {
      const nextContent = currentContent
        ? `${currentContent.endsWith('\n') ? currentContent : `${currentContent}\n`}${pattern}\n`
        : `${pattern}\n`;
      await fs.writeFile(ignoreFilePath, nextContent, 'utf8');
    }

    const { stdout: trackedOutput } = await runGit(
      context.repoPath,
      [context.gitBinary, 'ls-files', '-z', '--', repoRelativeTarget],
      { timeoutMs: 5000, okCodes: [0] }
    );
    const trackedEntries = String(trackedOutput || '').split('\0').filter(Boolean);
    const stopTracking = trackedEntries.length > 0;

    if (stopTracking) {
      const rmArgs = context.stats.isDirectory()
        ? [context.gitBinary, 'rm', '-r', '-f', '--cached', '--ignore-unmatch', '--', repoRelativeTarget]
        : [context.gitBinary, 'rm', '-f', '--cached', '--ignore-unmatch', '--', repoRelativeTarget];
      await runGit(context.repoPath, rmArgs, { timeoutMs: 25000 });
    }

    return {
      ok: true,
      repoPath: context.repoPath,
      ignorePath: ignoreFilePath,
      added: alreadyPresent ? [] : [pattern],
      alreadyPresent: alreadyPresent ? [pattern] : [],
      stopTracking,
      untrackedPaths: stopTracking ? trackedEntries : []
    };
  }

  async function gitRemoveIgnore({ path: targetPathArg }) {
    const context = await resolveGitTargetContext(targetPathArg);
    const repoRelativeTarget = context.repoRelativePath;
    const matchesPayload = await gitCheckIgnore({ path: context.repoPath, files: [repoRelativeTarget] });
    const matches = Array.isArray(matchesPayload?.matches) ? matchesPayload.matches : [];
    const updates = new Map();

    for (const match of matches) {
      const sourceRaw = String(match?.source || '').trim();
      if (!sourceRaw) continue;
      const normalizedSource = normalizeSlashes(sourceRaw);
      const sourcePath = normalizedSource.startsWith('/') || /^[A-Za-z]:/.test(normalizedSource)
        ? normalizedSource
        : normalizeSlashes(path.join(context.repoPath, normalizedSource));
      if (!sourcePath.startsWith(`${normalizeSlashes(context.repoPath)}/`) && sourcePath !== normalizeSlashes(context.repoPath)) {
        continue;
      }
      const entry = updates.get(sourcePath) || { lines: new Set(), patterns: new Set() };
      if (Number.isFinite(match?.line)) entry.lines.add(match.line);
      if (match?.pattern) entry.patterns.add(String(match.pattern));
      updates.set(sourcePath, entry);
    }

    const normalizeCandidate = (value) => String(value || '').trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
    if (!updates.size) {
      const ignorePath = path.join(context.repoPath, '.gitignore');
      let content = '';
      try {
        content = await fs.readFile(ignorePath, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const normalized = normalizeCandidate(repoRelativeTarget);
      const candidates = new Set([normalized, `/${normalized}`]);
      if (context.stats.isDirectory()) {
        candidates.add(`${normalized}/`);
        candidates.add(`/${normalized}/`);
      }
      const lines = String(content || '').split(/\r?\n/);
      const removeIndexes = new Set();
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (candidates.has(trimmed)) removeIndexes.add(idx);
      });
      if (removeIndexes.size) {
        updates.set(ignorePath, { lines: removeIndexes, patterns: new Set() });
      }
    }

    if (!updates.size) {
      return { ok: true, repoPath: context.repoPath, removed: false, retracked: false };
    }

    let changedFiles = 0;
    for (const [sourcePath, entry] of updates.entries()) {
      let content = '';
      try {
        content = await fs.readFile(sourcePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const lines = String(content || '').split(/\r?\n/);
      const removeIndexes = new Set(
        Array.from(entry.lines.values())
          .map((lineNo) => Number(lineNo) - 1)
          .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < lines.length)
      );
      if (!removeIndexes.size && entry.patterns.size) {
        const patterns = Array.from(entry.patterns.values());
        lines.forEach((line, idx) => {
          const trimmed = line.trim();
          if (patterns.includes(trimmed)) removeIndexes.add(idx);
        });
      }
      if (!removeIndexes.size) continue;
      const nextLines = lines.filter((_, idx) => !removeIndexes.has(idx));
      let nextContent = nextLines.join('\n');
      if (content && content.endsWith('\n')) {
        nextContent = `${nextContent}\n`;
      } else if (nextContent && !nextContent.endsWith('\n')) {
        nextContent = `${nextContent}\n`;
      }
      await fs.writeFile(sourcePath, nextContent, 'utf8');
      changedFiles += 1;
    }

    let retracked = false;
    try {
      await runGit(context.repoPath, [context.gitBinary, 'add', '--', repoRelativeTarget], { timeoutMs: 25000 });
      retracked = true;
    } catch {
      retracked = false;
    }

    return {
      ok: true,
      repoPath: context.repoPath,
      removed: changedFiles > 0,
      retracked
    };
  }

  async function gitRestore({ path: repoPathArg, files = [] }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const list = Array.isArray(files) ? files : [];
    if (list.length) {
      for (const file of list) {
        if (!isGitRepoRelativePath(file)) throw new Error(`Invalid file path for git_restore: ${file}`);
      }
    }
    const target = list.length ? list : ['.'];
    if (list.length) {
      try {
        const statusPayload = await gitStatus({ path: repoPath });
        const status = statusPayload?.status || {};
        const specialStopTrackingPaths = new Set(getStopTrackingIgnoredPaths(status));
        const specialTargets = list.filter((file) => specialStopTrackingPaths.has(file));
        const remainingTargets = list.filter((file) => !specialTargets.includes(file));
        for (const file of specialTargets) {
          try {
            await runGit(repoPath, [gitBinary, 'reset', '-q', 'HEAD', '--', file], { timeoutMs: 25000 });
          } catch {
            await runGit(repoPath, [gitBinary, 'restore', '--source=HEAD', '--staged', '--', file], { timeoutMs: 25000 });
          }
        }
        if (!remainingTargets.length) {
          return { ok: true };
        }
        target.length = 0;
        target.push(...remainingTargets);
      } catch {
        // Fallback to the standard restore flow below.
      }
    }
    try {
      await runGit(repoPath, [gitBinary, 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...target]);
      return { ok: true };
    } catch {
      try {
        await runGit(repoPath, [gitBinary, 'reset', '-q', 'HEAD', '--', ...target]);
      } catch {
        // ignore reset fallback errors, checkout will surface the error if needed.
      }
      await runGit(repoPath, [gitBinary, 'checkout', '--', ...target]);
      return { ok: true };
    }
  }

  async function gitConflictVersions({ path: repoPathArg, file }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    if (!isGitRepoRelativePath(file)) {
      throw new Error(`Invalid file path for git_conflict_versions: ${file}`);
    }
    const gitBinary = await getGitBinary(repoPath);

    const readStage = async (stage) => {
      try {
        const { stdout } = await runGit(repoPath, [gitBinary, 'show', `:${stage}:${file}`], { timeoutMs: 20000 });
        return { content: stdout, error: null };
      } catch (error) {
        return { content: '', error: normalizeErrorMessage(error) };
      }
    };

    const base = await readStage(1);
    const ours = await readStage(2);
    const theirs = await readStage(3);

    return {
      ok: true,
      file,
      base: base.content,
      ours: ours.content,
      theirs: theirs.content,
      baseError: base.error,
      oursError: ours.error,
      theirsError: theirs.error
    };
  }

  async function gitCheckoutConflict({ path: repoPathArg, file, source }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    if (!isGitRepoRelativePath(file)) {
      throw new Error(`Invalid file path for git_checkout_conflict: ${file}`);
    }
    const gitBinary = await getGitBinary(repoPath);
    const side = source === 'theirs' ? '--theirs' : '--ours';
    await runGit(repoPath, [gitBinary, 'checkout', side, '--', file], { timeoutMs: 25000 });
    return { ok: true };
  }

  async function gitStash({ path: repoPathArg, includeUntracked = true, message = '' }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const listStash = async () => {
      try {
        const { stdout } = await runGit(repoPath, [gitBinary, 'stash', 'list'], { timeoutMs: 5000 });
        return stdout || '';
      } catch {
        return '';
      }
    };

    const beforeList = await listStash();
    let stashTargets = [];
    try {
      const statusPayload = await gitStatus({ path: repoPath });
      const status = statusPayload?.status || {};
      stashTargets = getStashTargetPaths(status);
    } catch {
      stashTargets = [];
    }
    if (!stashTargets.length) {
      return { ok: true, created: false, ref: null, output: 'No local changes to save', usedAll: false };
    }
    const args = [gitBinary, 'stash', 'push'];
    if (includeUntracked) args.push('-u');
    const cleanMessage = String(message || '').trim();
    if (cleanMessage) {
      args.push('-m', cleanMessage);
    }
    args.push('--', ...stashTargets);
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 20000 });
    const output = `${stdout}\n${stderr}`.trim();
    const afterList = await listStash();
    const lowerOutput = output.toLowerCase();
    const created = Boolean(afterList && afterList.trim() !== beforeList.trim() && !lowerOutput.includes('no local changes'));
    let ref = null;
    if (created) {
      const firstLine = afterList.split(/\r?\n/)[0] || '';
      ref = firstLine.split(':')[0].trim() || null;
    }
    return { ok: true, created, ref, output, usedAll: false };
  }

  async function gitStashList({ path: repoPathArg }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const { stdout } = await runGit(repoPath, [
      gitBinary,
      'stash',
      'list',
      '--date=iso',
      '--pretty=format:%gd|%s'
    ], { timeoutMs: 10000 });
    const output = String(stdout || '').trim();
    if (!output) {
      return { ok: true, entries: [] };
    }
    const entries = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [refPart, ...rest] = line.split('|');
        const ref = (refPart || '').trim();
        const dateMatch = ref.match(/\{([^}]+)\}/);
        const date = dateMatch ? dateMatch[1].trim() : '';
        const cleanDate = date.replace(/\s*[+-]\d{4}\s*$/, '');
        const cleanRef = cleanDate ? ref.replace(date, cleanDate) : ref;
        const message = rest.join('|').trim();
        return { ref: cleanRef, date: cleanDate, message, raw: line };
      })
      .filter((entry) => entry.ref);
    return { ok: true, entries };
  }
  async function gitStashPop({ path: repoPathArg, ref = null, reinstateIndex = true }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const args = [gitBinary, 'stash', 'pop'];
    if (reinstateIndex) args.push('--index');
    if (ref) args.push(ref);
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 30000, okCodes: [0, 1] });
    const output = `${stdout}\n${stderr}`.trim();
    const lower = output.toLowerCase();
    let conflicts = hasGitConflictOutput(output);
    const indexConflicts = lower.includes('conflicts in index') || lower.includes('try without --index');
    const noStash = lower.includes('no stash entries found');
    const untrackedRestoreCollision = lower.includes('already exists, no checkout')
      && lower.includes('could not restore untracked files from stash');
    const error = !conflicts && !indexConflicts && !noStash && (lower.includes('error:') || lower.includes('fatal:'));
    let conflictPaths = conflicts ? extractConflictPathsFromOutput(output) : [];
    if (conflicts) {
      const unmergedPaths = await listUnmergedPaths(repoPath, gitBinary);
      if (unmergedPaths.length) {
        conflicts = true;
        conflictPaths = unmergedPaths;
      }
    }
    if (conflicts && !conflictPaths.length) {
      try {
        const statusPayload = await gitStatus({ path: repoPathArg });
        const statusPaths = Array.isArray(statusPayload?.status?.conflicted)
          ? statusPayload.status.conflicted
              .map((entry) => String(entry?.path || entry || '').trim())
              .filter(Boolean)
          : [];
        if (statusPaths.length) {
          conflicts = true;
          conflictPaths = statusPaths;
        }
      } catch {
        // Keep output-derived conflict paths as a fallback.
      }
    }
    if (untrackedRestoreCollision && !conflicts && !indexConflicts) {
      try {
        const statusPayload = await gitStatus({ path: repoPathArg });
        const status = statusPayload?.status || {};
        const stopTrackingPaths = getStopTrackingIgnoredPaths(status);
        if (stopTrackingPaths.length > 0) {
          try {
            await runGit(repoPath, [gitBinary, 'stash', 'drop', ref || 'stash@{0}'], { timeoutMs: 10000 });
          } catch {
            // The working tree is already in the desired state; dropping the stash is best-effort.
          }
          return {
            ok: true,
            conflicts: false,
            indexConflicts: false,
            noStash: false,
            output,
            conflictPaths: [],
            restoredStopTrackingPaths: stopTrackingPaths
          };
        }
      } catch {
        // Fall through to the default error handling below.
      }
    }
    return { ok: !error, conflicts, indexConflicts, noStash, output, conflictPaths };
  }

  async function gitCommit({ path: repoPathArg, message, amend = false, signoff = false, userName = null, userEmail = null }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const args = [gitBinary];
    const cleanName = userName ? String(userName).trim() : '';
    const cleanEmail = userEmail ? String(userEmail).trim() : '';
    if (cleanName) args.push('-c', `user.name=${cleanName}`);
    if (cleanEmail) args.push('-c', `user.email=${cleanEmail}`);
    args.push('commit');
    if (amend) args.push('--amend');
    if (signoff) args.push('--signoff');
    if (message && message.trim()) {
      args.push('-m', message.trim());
    }
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 60000 });
    return { ok: true, stdout, stderr };
  }

  async function gitPush({ path: repoPathArg, remote = null, branch = null, setUpstream = false, token = null, _meta = null, params = null }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const guessRemoteForPush = async () => {
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
    };

    const remoteForAuth = remote || (await guessRemoteForPush()) || 'origin';
    let remoteUrl = '';
    try {
      const { stdout } = await runGit(repoPath, [gitBinary, 'remote', 'get-url', '--push', remoteForAuth], { timeoutMs: 5000 });
      remoteUrl = (stdout || '').trim();
    } catch {
      try {
        const { stdout } = await runGit(repoPath, [gitBinary, 'remote', 'get-url', remoteForAuth], { timeoutMs: 5000 });
        remoteUrl = (stdout || '').trim();
      } catch {
        remoteUrl = '';
      }
    }

    const explicitToken = token ? String(token).trim() : '';
    const metaGithubToken = getGithubAccessTokenFromMeta(_meta || (params && typeof params === 'object' ? params._meta : null) || { params });
    const effectiveToken = explicitToken || (isGithubHttpsRemote(remoteUrl) ? metaGithubToken : '');
    let extraHeader = null;
    if (effectiveToken) {
      const isHttp = remoteUrl.startsWith('http://') || remoteUrl.startsWith('https://');
      if (!isHttp) {
        throw new Error('Remote is not HTTPS; token auth is only supported for HTTPS remotes. Configure an HTTPS remote or push via SSH.');
      }
      extraHeader = toBasicAuthHeader({ username: 'x-access-token', token: effectiveToken });
    }

    const args = [gitBinary];
    if (extraHeader) {
      args.push('-c', `http.extraHeader=${extraHeader}`);
    }
    args.push('push');
    if (setUpstream) args.push('--set-upstream');
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 120000 });
    return { ok: true, stdout, stderr };
  }

  async function gitPull({ path: repoPathArg, remote = null, branch = null, rebase = false, ffOnly = true, token = null, _meta = null, params = null }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);

    const guessRemoteForPull = async () => {
      try {
        const { stdout } = await runGit(repoPath, [gitBinary, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 5000 });
        const upstream = (stdout || '').trim();
        if (upstream && upstream.includes('/')) return upstream.split('/')[0];
      } catch {}
      try {
        const { stdout } = await runGit(repoPath, [gitBinary, 'config', '--get', 'remote.pushDefault'], { timeoutMs: 5000 });
        const v = (stdout || '').trim();
        if (v) return v;
      } catch {}
      return null;
    };

    const remoteForAuth = remote || (await guessRemoteForPull()) || 'origin';
    let remoteUrl = '';
    try {
      const { stdout } = await runGit(repoPath, [gitBinary, 'remote', 'get-url', remoteForAuth], { timeoutMs: 5000 });
      remoteUrl = (stdout || '').trim();
    } catch {
      remoteUrl = '';
    }

    const explicitToken = token ? String(token).trim() : '';
    const metaGithubToken = getGithubAccessTokenFromMeta(_meta || (params && typeof params === 'object' ? params._meta : null) || { params });
    const effectiveToken = explicitToken || (isGithubHttpsRemote(remoteUrl) ? metaGithubToken : '');
    let extraHeader = null;
    if (effectiveToken) {
      if (!remoteUrl) {
        throw new Error(`No remote '${remoteForAuth}' configured for repository at ${repoPath}. Ensure the repository has a remote configured.`);
      }
      const isHttp = remoteUrl.startsWith('http://') || remoteUrl.startsWith('https://');
      if (!isHttp) {
        throw new Error('Remote is not HTTPS; token auth is only supported for HTTPS remotes. Configure an HTTPS remote or pull via SSH.');
      }
      extraHeader = toBasicAuthHeader({ username: 'x-access-token', token: effectiveToken });
    }

    const args = [gitBinary];
    if (extraHeader) {
      args.push('-c', `http.extraHeader=${extraHeader}`);
    }
    args.push('pull');
    // Newer git versions may require explicitly choosing the reconcile strategy when branches diverge.
    // Keep defaults safe: ff-only unless user explicitly chose merge/rebase.
    if (ffOnly) {
      args.push('--ff-only');
    } else if (rebase) {
      args.push('--rebase=true');
      args.push('--ff');
    } else {
      // Explicit merge strategy.
      args.push('--rebase=false');
      args.push('--ff');
    }
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 180000 });
    return { ok: true, stdout, stderr };
  }

  async function gitDiagnose({ path: repoPathArg }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const configured = process.env.ASSISTOS_GIT_BINARY || process.env.GIT_BINARY || null;
    const envPath = process.env.PATH || null;
    const candidates = [
      'git',
      '/usr/bin/git',
      '/bin/git',
      '/usr/local/bin/git',
      '/opt/homebrew/bin/git'
    ];
    const results = [];
    for (const candidate of candidates) {
      const row = { candidate, version: null, error: null };
      try {
        const { stdout } = await runGit(repoPath, [candidate, '--version'], { timeoutMs: 5000 });
        row.version = stdout.trim() || null;
      } catch (error) {
        row.error = normalizeErrorMessage(error);
      }
      results.push(row);
    }

    let selected = null;
    let selectedError = null;
    try {
      selected = await getGitBinary(repoPath);
    } catch (error) {
      selectedError = normalizeErrorMessage(error);
    }

    return {
      ok: Boolean(selected),
      repoPath,
      cwd: process.cwd(),
      configured,
      envPath,
      selected,
      selectedError,
      candidates: results
    };
  }

  async function gitIdentity({ path: repoPathArg }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);

    const getValue = async (args) => {
      try {
        const { stdout } = await runGit(repoPath, [gitBinary, 'config', '--get', ...args], { timeoutMs: 5000 });
        return (stdout || '').trim();
      } catch {
        return '';
      }
    };

    const localName = await getValue(['user.name']);
    const localEmail = await getValue(['user.email']);
    const globalName = await getValue(['--global', 'user.name']);
    const globalEmail = await getValue(['--global', 'user.email']);

    const effectiveName = localName || globalName || '';
    const effectiveEmail = localEmail || globalEmail || '';

    return {
      ok: Boolean(effectiveName && effectiveEmail),
      repoPath,
      effective: {
        name: effectiveName || null,
        email: effectiveEmail || null,
        source: localName || localEmail ? 'local' : globalName || globalEmail ? 'global' : 'none'
      },
      local: { name: localName || null, email: localEmail || null },
      global: { name: globalName || null, email: globalEmail || null }
    };
  }

  async function gitSetIdentity({ path: repoPathArg, scope = 'local', name, email }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const cleanName = normalizeGitConfigValue(name);
    const cleanEmail = normalizeGitConfigValue(email);
    if (!cleanName) throw new Error('Missing user.name');
    if (!cleanEmail) throw new Error('Missing user.email');

    const isGlobal = scope === 'global';
    const argsPrefix = isGlobal ? [gitBinary, 'config', '--global'] : [gitBinary, 'config'];
    await runGit(repoPath, [...argsPrefix, 'user.name', cleanName], { timeoutMs: 5000 });
    await runGit(repoPath, [...argsPrefix, 'user.email', cleanEmail], { timeoutMs: 5000 });
    return { ok: true, scope: isGlobal ? 'global' : 'local', repoPath };
  }

  async function gitReposOverview({ path: reposRootArg, maxRepos = 200 }) {
    const reposRoot = await resolveRepoPath(reposRootArg);
    const limit = Number.isFinite(maxRepos) ? Math.max(1, Math.min(500, Math.floor(maxRepos))) : 200;

    async function existsGitMarker(dirPath) {
      try {
        const stat = await fs.stat(path.join(dirPath, '.git'));
        return stat.isDirectory() || stat.isFile();
      } catch {
        return false;
      }
    }

    async function scanGitRepos(rootDir, { maxDepth = 4, maxRepos = limit } = {}) {
      const queue = [{ dir: rootDir, depth: 0 }];
      const repos = [];
      const seen = new Set();

      while (queue.length && repos.length < maxRepos) {
        const { dir, depth } = queue.shift();
        const resolved = path.resolve(dir);
        if (seen.has(resolved)) continue;
        seen.add(resolved);

        if (depth > maxDepth) continue;
        const baseName = path.basename(dir);
        if (baseName === '.git') continue;

        if (dir !== rootDir && await existsGitMarker(dir)) {
          repos.push({
            path: dir,
            relativePath: path.posix.normalize(path.relative(rootDir, dir).split(path.sep).join('/')),
            name: path.basename(dir)
          });
          continue;
        }

        let children;
        try {
          children = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of children) {
          if (!entry?.isDirectory?.()) continue;
          if (entry.name.startsWith('.')) continue;
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
      }
      return repos;
    }

    const candidates = await scanGitRepos(reposRoot, { maxDepth: 4, maxRepos: limit });

    const results = [];
    const concurrency = 4;
    let index = 0;

    const worker = async () => {
      while (index < candidates.length) {
        const current = candidates[index];
        index += 1;
        let info;
        try {
          info = await gitInfo({ path: current.path });
        } catch {
          info = { ok: false };
        }
        if (!info || info.ok === false) {
          results.push({
            ...current,
            ok: false,
            branch: null,
            dirty: false,
            counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
            sample: { staged: [], unstaged: [], untracked: [], conflicted: [] }
          });
          continue;
        }
        try {
          // Include untracked so repos with only new files still show up as "dirty" (WebStorm-like).
          const statusPayload = await gitStatusOverview({ path: current.path, includeUntracked: true });
          const status = statusPayload?.status || {};
          const staged = Array.isArray(status.staged) ? status.staged : [];
          const unstaged = Array.isArray(status.unstaged) ? status.unstaged : [];
          const untracked = Array.isArray(status.untracked) ? status.untracked : [];
          const conflicted = Array.isArray(status.conflicted) ? status.conflicted : [];
          const ignored = Array.isArray(status.ignored) ? status.ignored : [];
          const dirty = staged.length > 0 || unstaged.length > 0 || untracked.length > 0 || conflicted.length > 0;

          if (!dirty) {
            results.push({
              ...current,
              ok: true,
              branch: info.branch || null,
              dirty: false,
              counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
              sample: { staged: [], unstaged: [], untracked: [], conflicted: [] },
              ignored: ignored.slice(0, 800).map((e) => e?.path).filter(Boolean),
              ignoredCount: ignored.length
            });
            continue;
          }

          // For dirty repos, fetch full status incl. untracked to build the WebStorm-like changes tree.
          let fullStatus = status;
          try {
            const full = await gitStatus({ path: current.path });
            fullStatus = full?.status || fullStatus;
          } catch {
            // keep overview-only status
          }
          const fullStaged = Array.isArray(fullStatus.staged) ? fullStatus.staged : staged;
          const fullUnstaged = Array.isArray(fullStatus.unstaged) ? fullStatus.unstaged : unstaged;
          const fullUntracked = Array.isArray(fullStatus.untracked) ? fullStatus.untracked : [];
          const fullConflicted = Array.isArray(fullStatus.conflicted) ? fullStatus.conflicted : conflicted;
          const fullIgnored = Array.isArray(fullStatus.ignored) ? fullStatus.ignored : ignored;
          const toPaths = (items, limit = 250) => items.slice(0, limit).map((e) => e?.path).filter(Boolean);
          const toChangeRows = (status, limit = 800) => {
            const map = new Map();
            const stopTrackingIgnoredPaths = new Set(getStopTrackingIgnoredPaths(status));
            const touch = (entry, flag) => {
              if (!entry?.path) return;
              const key = entry.path;
              const existing = map.get(key) || {
                path: key,
                flags: { staged: false, unstaged: false, untracked: false, conflicted: false, ignored: false, stopTrackingIgnored: false },
                origPath: null,
                x: ' ',
                y: ' '
              };
              existing.flags[flag] = true;
              existing.flags.stopTrackingIgnored = stopTrackingIgnoredPaths.has(key);
              if (entry.origPath && !existing.origPath) existing.origPath = entry.origPath;
              if (typeof entry.x === 'string' && entry.x.length) {
                if (existing.x === ' ' || existing.x === '?' || entry.x !== ' ') {
                  existing.x = entry.x;
                }
              }
              if (typeof entry.y === 'string' && entry.y.length) {
                if (existing.y === ' ' || existing.y === '?' || entry.y !== ' ') {
                  existing.y = entry.y;
                }
              }
              map.set(key, existing);
            };

            for (const entry of (status.conflicted || []).slice(0, limit)) touch(entry, 'conflicted');
            for (const entry of (status.ignored || []).slice(0, limit)) touch(entry, 'ignored');
            for (const entry of (status.untracked || []).slice(0, limit)) touch(entry, 'untracked');
            for (const entry of (status.unstaged || []).slice(0, limit)) touch(entry, 'unstaged');
            for (const entry of (status.staged || []).slice(0, limit)) touch(entry, 'staged');

            const rows = Array.from(map.values());
            for (const row of rows) {
              const f = row.flags || {};
              row.kind = f.stopTrackingIgnored ? 'stop-tracking-ignored'
                : f.conflicted ? 'conflicted'
                : (f.ignored && !f.staged && !f.unstaged && !f.untracked) ? 'ignored'
                  : f.untracked ? 'untracked'
                  : (f.staged && f.unstaged) ? 'staged+unstaged'
                    : f.staged ? 'staged'
                      : f.unstaged ? 'unstaged'
                        : 'unknown';
            }
            rows.sort((a, b) => a.path.localeCompare(b.path));
            return rows;
          };

          results.push({
            ...current,
            ok: true,
            branch: info.branch || null,
            dirty: true,
            counts: {
              staged: fullStaged.length,
              unstaged: fullUnstaged.length,
              untracked: fullUntracked.length,
              conflicted: fullConflicted.length
            },
            changesAll: toChangeRows({
              staged: fullStaged,
              unstaged: fullUnstaged,
              untracked: fullUntracked,
              conflicted: fullConflicted,
              ignored: fullIgnored
            }),
            changes: {
              staged: toPaths(fullStaged),
              unstaged: toPaths(fullUnstaged),
              untracked: toPaths(fullUntracked),
              conflicted: toPaths(fullConflicted)
            },
            sample: {
              staged: fullStaged.slice(0, 8).map((e) => e?.path).filter(Boolean),
              unstaged: fullUnstaged.slice(0, 8).map((e) => e?.path).filter(Boolean),
              untracked: fullUntracked.slice(0, 8).map((e) => e?.path).filter(Boolean),
              conflicted: fullConflicted.slice(0, 8).map((e) => e?.path).filter(Boolean)
            },
            ignored: toPaths(fullIgnored, 800),
            ignoredCount: fullIgnored.length
          });
        } catch {
          results.push({
            ...current,
            ok: true,
            branch: info.branch || null,
            dirty: false,
            counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
            sample: { staged: [], unstaged: [], untracked: [], conflicted: [] }
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));
    results.sort((a, b) => (a.relativePath || a.name).localeCompare(b.relativePath || b.name));
    return { ok: true, reposRoot, repos: results };
  }

  return {
    gitInfo,
    gitInitRepository,
    gitStatus,
    gitDiff,
    gitStage,
    gitStageExact,
    gitUnstage,
    gitUntrack,
    gitCheckIgnore,
    gitAddIgnore,
    gitRemoveIgnore,
    gitRestore,
    gitConflictVersions,
    gitCheckoutConflict,
    gitStash,
    gitStashList,
    gitStashPop,
    gitCommit,
    gitPull,
    gitPush,
    gitDiagnose,
    gitIdentity,
    gitSetIdentity,
    gitReposOverview,
    normalizeErrorMessage
  };
}
