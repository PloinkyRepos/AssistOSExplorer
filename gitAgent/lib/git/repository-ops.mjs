import fs from 'node:fs/promises';
import path from 'node:path';

import { runGit } from './run-git.mjs';
import { normalizeRemoteName, normalizeRemoteUrl, normalizeRepositoryName } from './validators.mjs';

export function createRepositoryOps(ctx) {
  const { validatePath, getGitBinary, resolveGitTargetContext, resolveRepoWorkTreePath } = ctx;

  async function gitInfo({ path: repoPathArg }) {
    let context = null;
    try {
      context = await resolveGitTargetContext(repoPathArg);
      const inside = await runGit(context.probePath, [context.gitBinary, 'rev-parse', '--is-inside-work-tree']);
      if (!inside.stdout.trim().startsWith('true')) {
        return { ok: false, branch: null, upstream: null, remotes: [], repoPath: null, repoRelativePath: '', ahead: 0, behind: 0 };
      }
    } catch {
      return { ok: false, branch: null, upstream: null, remotes: [], repoPath: null, repoRelativePath: '', ahead: 0, behind: 0 };
    }
  
    let branch = null;
    let upstream = null;
    let remotes = [];
    let ahead = 0;
    let behind = 0;
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
    if (upstream) {
      try {
        const res = await runGit(context.probePath, [context.gitBinary, 'rev-list', '--count', '--left-right', `${upstream}...HEAD`]);
        const parts = res.stdout.trim().split(/\s+/);
        if (parts.length === 2) {
          behind = parseInt(parts[0], 10) || 0;
          ahead = parseInt(parts[1], 10) || 0;
        }
      } catch {
        ahead = 0;
        behind = 0;
      }
    }
    return {
      ok: true,
      branch,
      upstream,
      remotes,
      repoPath: context.repoPath,
      repoRelativePath: context.repoRelativePath,
      ahead,
      behind
    };
  }
  
  async function gitInitRepository({ path: parentPathArg, name, remote = 'origin', remoteUrl }) {
    const validatedParentPath = await validatePath(parentPathArg || '/');
    const parentPath = await fs.realpath(validatedParentPath);
    const parentStats = await fs.lstat(parentPath);
    if (!parentStats.isDirectory()) {
      throw new Error('Repository parent path must be a directory.');
    }
  
    const repoName = normalizeRepositoryName(name);
    const configuredRemoteUrl = normalizeRemoteUrl(remoteUrl, { repositoryName: repoName });
    const configuredRemoteName = normalizeRemoteName(remote || 'origin');
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
      await runGit(targetPath, [gitBinary, 'remote', 'add', configuredRemoteName, configuredRemoteUrl], { timeoutMs: 10000 });
    } catch (error) {
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  
    const repoPath = await fs.realpath(targetPath);
    return {
      ok: true,
      parentPath,
      repoPath,
      name: repoName,
      remote: configuredRemoteName
    };
  }
  
  async function gitRemoteSet({ path: repoPathArg, remote = 'origin', url }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const remoteName = normalizeRemoteName(remote);
    const remoteUrl = normalizeRemoteUrl(url);
    try {
      await runGit(repoPath, [gitBinary, 'remote', 'get-url', remoteName], { timeoutMs: 5000 });
      await runGit(repoPath, [gitBinary, 'remote', 'set-url', remoteName, remoteUrl], { timeoutMs: 10000 });
    } catch {
      await runGit(repoPath, [gitBinary, 'remote', 'add', remoteName, remoteUrl], { timeoutMs: 10000 });
    }
    return { ok: true, remote: remoteName, url: remoteUrl };
  }

  return {
    gitInfo,
    gitInitRepository,
    gitRemoteSet,
  };
}
