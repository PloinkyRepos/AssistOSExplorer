import fs from 'node:fs/promises';
import path from 'node:path';

import { runGit } from './run-git.mjs';
import { getStopTrackingIgnoredPaths } from './status-parser.mjs';
import { isGitRepoRelativePath, isPathWithinIgnoredPath, normalizeGitRepoRelativePath } from './validators.mjs';

export function createStageOps(ctx, ops) {
  const { resolveRepoWorkTreePath, getGitBinary } = ctx;

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
  
    const statusPayload = list.length ? await ops.gitStatus({ path: repoPath }) : null;
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
        const statusPayload = await ops.gitStatus({ path: repoPath });
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

  return {
    gitStage,
    gitStageExact,
    gitUnstage,
    gitUntrack,
    gitCheckIgnore,
    gitRestore,
  };
}
