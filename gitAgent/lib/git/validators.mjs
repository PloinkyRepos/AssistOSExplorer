import path from 'node:path';

export function isGitRepoRelativePath(candidate) {
  if (typeof candidate !== 'string') return false;
  if (!candidate.trim()) return false;
  if (candidate.includes('\0')) return false;
  if (path.isAbsolute(candidate)) return false;
  const normalized = candidate.replaceAll('\\', '/');
  if (normalized.startsWith('../') || normalized === '..') return false;
  if (normalized.includes('/../')) return false;
  return true;
}

export function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function normalizeGitRepoRelativePath(candidate) {
  return String(candidate || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/g, '');
}

export function normalizeGitIgnorePattern(candidate, { directory = false } = {}) {
  const normalized = normalizeGitRepoRelativePath(candidate);
  if (!normalized) return '';
  return directory ? `${normalized}/` : normalized;
}

export function normalizeRepositoryName(candidate) {
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

export function normalizeRemoteName(candidate) {
  const value = String(candidate || 'origin').trim();
  if (!value || value.includes('\0') || value.startsWith('-') || /\s/.test(value)) {
    throw new Error('Invalid remote name.');
  }
  return value;
}

export function normalizeRemoteUrl(candidate, { repositoryName = '' } = {}) {
  const value = String(candidate || '').trim();
  if (!value) {
    throw new Error('Remote URL is required.');
  }
  if (value.includes('\0') || /\r|\n/.test(value)) {
    throw new Error('Invalid remote URL.');
  }
  const repoName = repositoryName ? normalizeRepositoryName(repositoryName) : '';
  const githubRepoMatch = value.match(/^(https?:\/\/github\.com\/[^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  if (githubRepoMatch) {
    return `${githubRepoMatch[1].replace(/\.git$/i, '')}.git`;
  }
  const githubSshRepoMatch = value.match(/^(git@github\.com:[^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  if (githubSshRepoMatch) {
    return `${githubSshRepoMatch[1].replace(/\.git$/i, '')}.git`;
  }
  if (repoName) {
    const githubHttpsOwnerMatch = value.match(/^(https?:\/\/github\.com\/[^/\s]+)\/?$/i);
    if (githubHttpsOwnerMatch) {
      return `${githubHttpsOwnerMatch[1]}/${repoName}.git`;
    }
    const githubSshOwnerMatch = value.match(/^(git@github\.com:[^/\s]+)\/?$/i);
    if (githubSshOwnerMatch) {
      return `${githubSshOwnerMatch[1]}/${repoName}.git`;
    }
  }
  return value;
}

export function normalizeRemoteIdentity(candidate) {
  const value = normalizeRemoteUrl(candidate).replace(/\/+$/g, '');
  const githubMatch = value.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (githubMatch) {
    return `github.com/${githubMatch[1]}/${githubMatch[2]}`.toLowerCase();
  }

  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    const pathname = parsed.pathname.replace(/\/+$/g, '').replace(/\.git$/i, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}`;
  } catch {
    return value.replace(/\.git$/i, '');
  }
}

export function normalizeGitConfigValue(value) {
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

export function isPathWithinIgnoredPath(candidate, ignoredPath) {
  const normalizedCandidate = normalizeGitRepoRelativePath(candidate);
  const normalizedIgnored = normalizeGitRepoRelativePath(ignoredPath);
  if (!normalizedCandidate || !normalizedIgnored) return false;
  return normalizedCandidate === normalizedIgnored || normalizedCandidate.startsWith(`${normalizedIgnored}/`);
}
