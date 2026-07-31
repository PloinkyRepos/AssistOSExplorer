import fs from 'node:fs/promises';
import path from 'node:path';

import { createGithubRepository, isGithubHttpsRemote, toBasicAuthHeader } from './github-remotes.mjs';
import { runGit } from './run-git.mjs';
import {
  normalizeGitRepoRelativePath,
  normalizeRemoteName,
  normalizeRemoteUrl,
  normalizeRepositoryName,
} from './validators.mjs';

export function createRepositoryOps(ctx) {
  const { validatePath, getGitBinary, resolveGitTargetContext, resolveRepoWorkTreePath } = ctx;

  async function rejectNestedRepositoryParent(parentPath) {
    const gitBinary = await getGitBinary(parentPath);
    let insideWorkTree = false;
    try {
      const result = await runGit(parentPath, [gitBinary, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 5000 });
      insideWorkTree = result.stdout.trim() === 'true';
    } catch {}
    if (insideWorkTree) {
      throw new Error('Cannot create an independent repository inside another Git repository. Add it as a Git submodule instead.');
    }
  }

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
    await rejectNestedRepositoryParent(parentPath);
  
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

  async function ensureRepositoryTargetPath(parentPathArg, name) {
    const validatedParentPath = await validatePath(parentPathArg || '/');
    const parentPath = await fs.realpath(validatedParentPath);
    const parentStats = await fs.lstat(parentPath);
    if (!parentStats.isDirectory()) {
      throw new Error('Repository parent path must be a directory.');
    }
    await rejectNestedRepositoryParent(parentPath);

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
    return { parentPath, repoName, targetPath };
  }

  async function gitCreateGithubRepository({ path: parentPathArg, owner, name, localName = '', visibility = 'private', remote = 'origin', token }) {
    const repoName = normalizeRepositoryName(name);
    const localRepoName = normalizeRepositoryName(localName || repoName);
    const repoOwner = String(owner || '').trim();
    if (!repoOwner) {
      throw new Error('GitHub owner is required.');
    }
    const { parentPath, targetPath } = await ensureRepositoryTargetPath(parentPathArg, localRepoName);
    const configuredRemoteName = normalizeRemoteName(remote || 'origin');
    const repository = await createGithubRepository({
      owner: repoOwner,
      name: repoName,
      visibility,
      token
    });
    const remoteUrl = normalizeRemoteUrl(repository?.repository?.cloneUrl || `https://github.com/${repoOwner}/${repoName}.git`);
    await fs.mkdir(targetPath, { recursive: false });
    const gitBinary = await getGitBinary(parentPath);
    try {
      await runGit(targetPath, [gitBinary, 'init'], { timeoutMs: 20000 });
      await runGit(targetPath, [gitBinary, 'remote', 'add', configuredRemoteName, remoteUrl], { timeoutMs: 10000 });
    } catch (error) {
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return {
      ok: true,
      parentPath,
      repoPath: await fs.realpath(targetPath),
      name: localRepoName,
      remote: configuredRemoteName,
      remoteUrl,
      repository: repository.repository
    };
  }

  async function gitCloneRepository({ path: parentPathArg, name = '', remote = 'origin', remoteUrl, token }) {
    const configuredRemoteUrl = normalizeRemoteUrl(remoteUrl);
    const defaultName = configuredRemoteUrl
      .replace(/\/+$/g, '')
      .replace(/\.git$/i, '')
      .split(/[/:]/)
      .filter(Boolean)
      .pop();
    const { parentPath, repoName, targetPath } = await ensureRepositoryTargetPath(parentPathArg, name || defaultName);
    const configuredRemoteName = normalizeRemoteName(remote || 'origin');
    const gitBinary = await getGitBinary(parentPath);
    const cloneArgs = [gitBinary];
    const authToken = String(token || '').trim();
    if (authToken && isGithubHttpsRemote(configuredRemoteUrl)) {
      cloneArgs.push('-c', `http.https://github.com/.extraheader=${toBasicAuthHeader({ token: authToken })}`);
    }
    cloneArgs.push('clone', '--origin', configuredRemoteName, configuredRemoteUrl, targetPath);
    try {
      await runGit(parentPath, cloneArgs, { timeoutMs: 120000 });
    } catch (error) {
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return {
      ok: true,
      parentPath,
      repoPath: await fs.realpath(targetPath),
      name: repoName,
      remote: configuredRemoteName,
      remoteUrl: configuredRemoteUrl
    };
  }

  async function gitSubmoduleAdd({ path: parentPathArg, name, remoteUrl, token }) {
    const context = await resolveGitTargetContext(parentPathArg);
    if (!context.stats.isDirectory()) {
      throw new Error('Submodule parent path must be a directory.');
    }

    const submoduleName = normalizeRepositoryName(name);
    const configuredRemoteUrl = normalizeRemoteUrl(remoteUrl);
    const targetPath = path.join(context.targetPath, submoduleName);
    await validatePath(targetPath);
    const relativeTarget = normalizeGitRepoRelativePath(path.relative(context.repoPath, targetPath));
    if (!relativeTarget || relativeTarget.startsWith('../') || path.isAbsolute(relativeTarget)) {
      throw new Error('Submodule target path must be inside the parent Git repository.');
    }

    try {
      await fs.lstat(targetPath);
      throw new Error(`Submodule directory already exists: ${submoduleName}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    const command = [context.gitBinary];
    let localRemotePath = '';
    if (path.isAbsolute(configuredRemoteUrl)) {
      localRemotePath = configuredRemoteUrl;
    } else if (configuredRemoteUrl.startsWith('file://')) {
      try {
        localRemotePath = decodeURIComponent(new URL(configuredRemoteUrl).pathname);
      } catch {
        throw new Error('Invalid local Git remote URL.');
      }
    }
    if (localRemotePath) {
      await validatePath(localRemotePath);
      command.push('-c', 'protocol.file.allow=always');
    }
    const authToken = String(token || '').trim();
    if (authToken && isGithubHttpsRemote(configuredRemoteUrl)) {
      command.push('-c', `http.https://github.com/.extraheader=${toBasicAuthHeader({ token: authToken })}`);
    }
    command.push('submodule', 'add', configuredRemoteUrl, relativeTarget);

    const commonDirResult = await runGit(context.repoPath, [context.gitBinary, 'rev-parse', '--git-common-dir'], { timeoutMs: 5000 });
    const commonDirValue = commonDirResult.stdout.trim();
    const commonDir = path.isAbsolute(commonDirValue)
      ? commonDirValue
      : path.resolve(context.repoPath, commonDirValue);
    const submoduleGitDir = path.join(commonDir, 'modules', ...relativeTarget.split('/'));
    await validatePath(submoduleGitDir);

    try {
      await runGit(context.repoPath, command, { timeoutMs: 120000 });
    } catch (error) {
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      await fs.rm(submoduleGitDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    return {
      ok: true,
      parentRepoPath: context.repoPath,
      repoPath: await fs.realpath(targetPath),
      submodulePath: relativeTarget,
      name: submoduleName,
      remoteUrl: configuredRemoteUrl,
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
    gitCreateGithubRepository,
    gitCloneRepository,
    gitInitRepository,
    gitSubmoduleAdd,
    gitRemoteSet,
  };
}
