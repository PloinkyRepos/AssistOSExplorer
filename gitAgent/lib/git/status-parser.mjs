import { normalizeGitRepoRelativePath } from './validators.mjs';

export function parseStatusPorcelainV1Z(output) {
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

export function categorizeStatusEntries(entries) {
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

export function getStopTrackingIgnoredPaths(status = {}) {
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

export function getStashTargetPaths(status = {}, { includeIgnoredStopTracking = false } = {}) {
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

export function hasPathspecUnsafeStagedDeletion(status = {}) {
  const stopTrackingIgnored = new Set(getStopTrackingIgnoredPaths(status));
  return (Array.isArray(status.staged) ? status.staged : [])
    .some((entry) => entry?.path && entry.x === 'D' && !stopTrackingIgnored.has(entry.path));
}

export function getBroadStashPathspecs(status = {}) {
  const pathspecs = ['.'];
  for (const segment of DEFAULT_STASH_EXCLUDED_DIRS) {
    pathspecs.push(`:(exclude,glob)${segment}/**`);
    pathspecs.push(`:(exclude,glob)**/${segment}/**`);
  }
  for (const candidate of getStopTrackingIgnoredPaths(status)) {
    const normalized = normalizeGitRepoRelativePath(candidate);
    if (normalized) {
      pathspecs.push(`:(exclude)${normalized}`);
    }
  }
  return pathspecs;
}
