import fs from 'node:fs/promises';
import path from 'node:path';

function assertWithinRoot(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error('Requested path resolves outside the workspace root.');
}

function containsNulByte(value) {
  return String(value || '').includes('\u0000');
}

function normalizeRelativePath(requestedPath) {
  const raw = String(requestedPath || '').trim().replace(/\\/g, '/');
  if (!raw) {
    throw new Error('Requested path is required.');
  }
  if (containsNulByte(raw)) {
    throw new Error('Requested path contains a NUL byte.');
  }
  const stripped = raw.replace(/^\/+/g, '');
  const normalized = path.posix.normalize(stripped);
  if (!normalized || normalized === '.' || normalized === '') {
    throw new Error('Requested path is required.');
  }
  if (normalized === 'Confidential' || normalized.startsWith('Confidential/')) {
    throw new Error('/Confidential paths must use DPU storage.');
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Requested path resolves outside the workspace root.');
  }
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.secrets' || segment.endsWith('.secrets'))) {
    throw new Error('Workspace path policy rejects .secrets files.');
  }
  return normalized;
}

async function assertNoExistingSymlinkEscape(workspaceRoot, relativePath) {
  const rootRealPath = await fs.realpath(workspaceRoot);
  const segments = relativePath.split('/').filter(Boolean);
  let currentPath = workspaceRoot;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const stat = await fs.lstat(currentPath);
      if (!stat) break;
      const realPath = await fs.realpath(currentPath);
      assertWithinRoot(realPath, rootRealPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

export function createWorkspacePathPolicy({ workspaceRoot } = {}) {
  const resolvedWorkspaceRoot = path.resolve(String(workspaceRoot || ''));
  if (!resolvedWorkspaceRoot || resolvedWorkspaceRoot === path.resolve('/')) {
    throw new Error('workspaceRoot is required.');
  }

  return {
    async resolve(requestedPath) {
      const relativePath = normalizeRelativePath(requestedPath);
      const absolutePath = path.resolve(resolvedWorkspaceRoot, relativePath);
      assertWithinRoot(absolutePath, resolvedWorkspaceRoot);
      await assertNoExistingSymlinkEscape(resolvedWorkspaceRoot, relativePath);
      return {
        absolutePath,
        relativePath,
      };
    },
  };
}

export default {
  createWorkspacePathPolicy,
};
