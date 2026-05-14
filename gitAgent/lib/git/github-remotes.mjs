import { Buffer } from 'node:buffer';

import { runGit } from './run-git.mjs';

export function toBasicAuthHeader({ username, token }) {
  const user = String(username || 'x-access-token');
  const pass = String(token || '');
  const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Authorization: Basic ${encoded}`;
}

export function isGithubHttpsRemote(remoteUrl) {
  const value = String(remoteUrl || '').trim().toLowerCase();
  return value.startsWith('https://github.com/') || value.startsWith('http://github.com/');
}

function parseGithubHttpsRepositoryRemote(remoteUrl) {
  const normalized = String(remoteUrl || '').trim().replace(/\/+$/g, '').replace(/\.git$/i, '');
  const match = normalized.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    canonicalUrl: `https://github.com/${match[1]}/${match[2]}.git`
  };
}

async function readGithubApiError(response) {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const payload = JSON.parse(text);
    return String(payload?.message || text).trim();
  } catch {
    return text.trim();
  }
}

export async function ensureGithubHttpsRemoteRepository({ repoPath, gitBinary, remoteName, remoteUrl, token }) {
  const parsed = parseGithubHttpsRepositoryRemote(remoteUrl);
  if (!parsed) return;

  if (parsed.canonicalUrl !== remoteUrl) {
    await runGit(repoPath, [gitBinary, 'remote', 'set-url', remoteName, parsed.canonicalUrl], { timeoutMs: 10000 });
  }

  const authToken = String(token || '').trim();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ploinky-git-agent'
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const repoResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
    { method: 'HEAD', headers }
  );
  if (repoResponse.ok) return;
  if (repoResponse.status !== 404) {
    throw new Error(await readGithubApiError(repoResponse) || `GitHub repository lookup failed (${repoResponse.status}).`);
  }
  if (!authToken) {
    throw new Error('GitHub authentication is required to create the remote repository.');
  }

  const userResponse = await fetch('https://api.github.com/user', {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${authToken}`,
      'User-Agent': 'ploinky-git-agent'
    }
  });
  if (!userResponse.ok) {
    throw new Error('GitHub authentication is required to create the remote repository.');
  }
  const userPayload = await userResponse.json().catch(() => ({}));
  const login = String(userPayload?.login || '').trim();
  if (!login) {
    throw new Error('GitHub authentication did not return an account login.');
  }

  const createUrl = parsed.owner.toLowerCase() === login.toLowerCase()
    ? 'https://api.github.com/user/repos'
    : `https://api.github.com/orgs/${encodeURIComponent(parsed.owner)}/repos`;
  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ploinky-git-agent'
    },
    body: JSON.stringify({
      name: parsed.repo,
      auto_init: false
    })
  });
  if (!createResponse.ok) {
    throw new Error(await readGithubApiError(createResponse) || `Cannot create GitHub repository ${parsed.owner}/${parsed.repo} (${createResponse.status}).`);
  }
}

export function getGithubAccessTokenFromMeta(meta) {
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
