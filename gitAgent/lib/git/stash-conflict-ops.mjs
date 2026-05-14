import fs from 'node:fs/promises';
import path from 'node:path';

import { extractConflictPathsFromOutput, hasGitConflictOutput, listUnmergedPaths } from './conflict-utils.mjs';
import { normalizeErrorMessage, runGit } from './run-git.mjs';
import { getBroadStashPathspecs, getStashTargetPaths, getStopTrackingIgnoredPaths, hasPathspecUnsafeStagedDeletion } from './status-parser.mjs';
import { isGitRepoRelativePath } from './validators.mjs';

async function listCanonicalStashEntries(repoPath, gitBinary) {
  const { stdout } = await runGit(repoPath, [
    gitBinary,
    'stash',
    'list',
    '--pretty=format:%gd|%H|%s',
  ], { timeoutMs: 10000 });
  const output = String(stdout || '').trim();
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [refPart, oidPart, ...rest] = line.split('|');
      return {
        ref: String(refPart || '').trim(),
        oid: String(oidPart || '').trim(),
        message: rest.join('|').trim(),
        raw: line,
      };
    })
    .filter((entry) => entry.ref);
}

async function resolveCanonicalStashRef(repoPath, gitBinary, ref) {
  const normalized = String(ref || '').trim();
  if (!normalized) return null;
  if (/^stash@\{.*\}$/i.test(normalized)) {
    return normalized;
  }
  if (!/^[0-9a-f]{40}$/i.test(normalized)) {
    return normalized;
  }
  try {
    const entries = await listCanonicalStashEntries(repoPath, gitBinary);
    const match = entries.find((entry) => entry.oid.toLowerCase() === normalized.toLowerCase());
    return match?.ref || normalized;
  } catch {
    return normalized;
  }
}

export function createStashConflictOps(ctx, ops) {
  const { resolveRepoWorkTreePath, getGitBinary } = ctx;

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
    const conflict = await (async () => {
      if (base.error || ours.error || theirs.error) return '';
      let tempDir = '';
      try {
        tempDir = await fs.mkdtemp(path.join('/tmp', 'git-conflict-preview-'));
        const basePath = path.join(tempDir, 'base');
        const oursPath = path.join(tempDir, 'ours');
        const theirsPath = path.join(tempDir, 'theirs');
        await fs.writeFile(basePath, base.content, 'utf8');
        await fs.writeFile(oursPath, ours.content, 'utf8');
        await fs.writeFile(theirsPath, theirs.content, 'utf8');
        const { stdout } = await runGit(
          tempDir,
          [gitBinary, 'merge-file', '-p', oursPath, basePath, theirsPath],
          { timeoutMs: 20000, okCodes: [0, 1] }
        );
        return stdout || '';
      } catch {
        return '';
      } finally {
        if (tempDir) {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch {
            // Ignore temporary preview cleanup errors.
          }
        }
      }
    })();
  
    return {
      ok: true,
      file,
      base: base.content,
      ours: ours.content,
      theirs: theirs.content,
      conflict,
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
    try {
      await runGit(repoPath, [gitBinary, 'rev-parse', 'HEAD'], { timeoutMs: 5000 });
    } catch {
      return { ok: true, created: false, ref: null, output: 'No commits yet. Nothing to stash.', usedAll: false };
    }
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
    let useBroadPathspec = false;
    let status = {};
    try {
      const statusPayload = await ops.gitStatus({ path: repoPath });
      status = statusPayload?.status || {};
      stashTargets = getStashTargetPaths(status);
      useBroadPathspec = hasPathspecUnsafeStagedDeletion(status);
    } catch {
      stashTargets = [];
      status = {};
      useBroadPathspec = false;
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
    args.push('--', ...(useBroadPathspec ? getBroadStashPathspecs(status) : stashTargets));
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
    return { ok: true, created, ref, output, usedAll: useBroadPathspec };
  }
  
  async function gitStashList({ path: repoPathArg }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const entries = await listCanonicalStashEntries(repoPath, gitBinary);
    return { ok: true, entries };
  }
  
  async function gitStashPop({ path: repoPathArg, ref = null, reinstateIndex = true }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const canonicalRef = await resolveCanonicalStashRef(repoPath, gitBinary, ref);
    const args = [gitBinary, 'stash', 'pop'];
    if (reinstateIndex) args.push('--index');
    if (canonicalRef) args.push(canonicalRef);
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
        const statusPayload = await ops.gitStatus({ path: repoPathArg });
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
        const statusPayload = await ops.gitStatus({ path: repoPathArg });
        const status = statusPayload?.status || {};
        const stopTrackingPaths = getStopTrackingIgnoredPaths(status);
        if (stopTrackingPaths.length > 0) {
          try {
            await runGit(repoPath, [gitBinary, 'stash', 'drop', canonicalRef || 'stash@{0}'], { timeoutMs: 10000 });
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

  return {
    gitConflictVersions,
    gitCheckoutConflict,
    gitStash,
    gitStashList,
    gitStashPop,
  };
}
