import fs from 'node:fs/promises';
import path from 'node:path';

import { runGit } from './run-git.mjs';
import { normalizeGitIgnorePattern, normalizeSlashes } from './validators.mjs';

export function createIgnoreOps(ctx, ops) {
  const { resolveGitTargetContext } = ctx;

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
    const matchesPayload = await ops.gitCheckIgnore({ path: context.repoPath, files: [repoRelativeTarget] });
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

  return {
    gitAddIgnore,
    gitRemoveIgnore,
  };
}
