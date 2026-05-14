import fs from 'node:fs/promises';
import path from 'node:path';

import { getStopTrackingIgnoredPaths } from './status-parser.mjs';

export function createOverviewOps(ctx, ops) {
  const { resolveRepoPath } = ctx;

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
          info = await ops.gitInfo({ path: current.path });
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
          const statusPayload = await ops.gitStatusOverview({ path: current.path, includeUntracked: true });
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
              ignoredCount: ignored.length,
              ahead: info.ahead || 0,
              behind: info.behind || 0
            });
            continue;
          }
  
          // For dirty repos, fetch full status incl. untracked to build the WebStorm-like changes tree.
          let fullStatus = status;
          try {
            const full = await ops.gitStatus({ path: current.path });
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
            ignoredCount: fullIgnored.length,
            ahead: info.ahead || 0,
            behind: info.behind || 0
          });
        } catch {
          results.push({
            ...current,
            ok: true,
            branch: info.branch || null,
            dirty: false,
            counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
            sample: { staged: [], unstaged: [], untracked: [], conflicted: [] },
            ahead: info.ahead || 0,
            behind: info.behind || 0
          });
        }
      }
    };
  
    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));
    results.sort((a, b) => (a.relativePath || a.name).localeCompare(b.relativePath || b.name));
    return { ok: true, reposRoot, repos: results };
  }

  return { gitReposOverview };
}
