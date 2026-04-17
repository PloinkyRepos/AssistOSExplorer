import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getStoredGitToken,
  putStoredGitToken,
  deleteStoredGitToken
} from './secret-store-client.mjs';

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';
const DEFAULT_CLIENT_ID = 'Ov23liRKJjJHqo3zOOI6';
const DEFAULT_SCOPE = 'repo workflow read:user user:email';
const STATE_FILE = path.join('.ploinky', 'state', 'git-agent-github-auth.json');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveWorkspaceRoot(workspaceRoot) {
  return path.resolve(workspaceRoot || process.cwd());
}

function getStateFilePath(workspaceRoot) {
  return path.join(resolveWorkspaceRoot(workspaceRoot), STATE_FILE);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureParentDirectory(filePath);
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function getGithubSetup() {
  return {
    configured: true,
    clientId: DEFAULT_CLIENT_ID,
    scope: DEFAULT_SCOPE
  };
}

function sanitizePending(pending) {
  if (!pending || typeof pending !== 'object') {
    return null;
  }
  if (!isNonEmptyString(pending.deviceCode) && !isNonEmptyString(pending.userCode)) {
    return null;
  }
  const expiresAt = Number.isFinite(Number(pending.expiresAt)) ? Number(pending.expiresAt) : 0;
  if (expiresAt && expiresAt <= Date.now()) {
    return null;
  }
  return {
    deviceCode: isNonEmptyString(pending.deviceCode) ? pending.deviceCode.trim() : '',
    userCode: isNonEmptyString(pending.userCode) ? pending.userCode.trim() : '',
    verificationUri: isNonEmptyString(pending.verificationUri) ? pending.verificationUri.trim() : 'https://github.com/login/device',
    verificationUriComplete: isNonEmptyString(pending.verificationUriComplete) ? pending.verificationUriComplete.trim() : '',
    interval: Math.max(5, Number.parseInt(String(pending.interval || '5'), 10) || 5),
    expiresAt,
    createdAt: Number.isFinite(Number(pending.createdAt)) ? Number(pending.createdAt) : Date.now()
  };
}

function sanitizeUser(user = {}) {
  return {
    id: Number.isFinite(Number(user.id)) ? Number(user.id) : null,
    login: isNonEmptyString(user.login) ? user.login.trim() : '',
    name: isNonEmptyString(user.name) ? user.name.trim() : '',
    email: isNonEmptyString(user.email) ? user.email.trim() : '',
    avatarUrl: isNonEmptyString(user.avatarUrl) ? user.avatarUrl.trim() : '',
    profileUrl: isNonEmptyString(user.profileUrl) ? user.profileUrl.trim() : ''
  };
}

function sanitizeConnection(connection) {
  if (!connection || typeof connection !== 'object') {
    return null;
  }
  return {
    provider: 'github',
    accessToken: '',
    tokenType: isNonEmptyString(connection.tokenType) ? connection.tokenType.trim() : 'bearer',
    scope: isNonEmptyString(connection.scope) ? connection.scope.trim() : '',
    source: isNonEmptyString(connection.source) ? connection.source.trim() : 'github',
    user: sanitizeUser(connection.user || {}),
    connectedAt: Number.isFinite(Number(connection.connectedAt)) ? Number(connection.connectedAt) : Date.now(),
    updatedAt: Number.isFinite(Number(connection.updatedAt)) ? Number(connection.updatedAt) : Date.now()
  };
}

function stripAccessToken(connection) {
  if (!connection) {
    return null;
  }
  const { accessToken, ...rest } = connection;
  return rest;
}

async function loadState(workspaceRoot) {
  const state = await readJsonFile(getStateFilePath(workspaceRoot), {});
  const pending = sanitizePending(state.pending);
  const connection = sanitizeConnection(state.connection);
  const nextState = {
    pending,
    connection
  };
  if (
    state?.pending !== nextState.pending
    || state?.connection !== nextState.connection
  ) {
    await saveState(workspaceRoot, nextState);
  }
  return nextState;
}

async function saveState(workspaceRoot, state) {
  await writeJsonFile(getStateFilePath(workspaceRoot), {
    pending: sanitizePending(state?.pending),
    connection: sanitizeConnection(state?.connection)
  });
}

function buildStatusPayload(setup, state, extras = {}) {
  const pending = sanitizePending(state?.pending);
  const connection = sanitizeConnection(state?.connection);
  const connected = Boolean(connection && (connection.user?.login || connection.user?.name || connection.scope || connection.source));
  const tokenStored = Boolean(extras?.tokenStored);
  return {
    ok: true,
    configured: Boolean(setup?.configured),
    connected,
    tokenStored,
    connection: stripAccessToken(connection),
    pending: pending
      ? {
          userCode: pending.userCode,
          verificationUri: pending.verificationUri,
          verificationUriComplete: pending.verificationUriComplete,
          interval: pending.interval,
          expiresAt: pending.expiresAt
        }
      : null,
    setup: {
      configured: Boolean(setup?.configured),
      scope: setup?.scope || DEFAULT_SCOPE
    },
    ...extras
  };
}

async function postGitHubForm(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error_description || payload?.error || `GitHub request failed (${response.status})`;
    throw new Error(String(detail));
  }
  return payload;
}

async function fetchGitHubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'ploinky-git-agent'
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `GitHub API request failed (${response.status})`);
  }
  return response.json();
}

async function fetchGithubUserProfile(accessToken) {
  const [userPayload, emailsPayload] = await Promise.all([
    fetchGitHubJson(GITHUB_USER_URL, accessToken),
    fetchGitHubJson(GITHUB_EMAILS_URL, accessToken).catch(() => [])
  ]);
  const primaryEmail = Array.isArray(emailsPayload)
    ? emailsPayload.find((entry) => entry?.primary && entry?.verified)?.email
        || emailsPayload.find((entry) => entry?.verified)?.email
        || emailsPayload.find((entry) => entry?.email)?.email
        || ''
    : '';
  return sanitizeUser({
    id: userPayload?.id,
    login: userPayload?.login,
    name: userPayload?.name || userPayload?.login || '',
    email: userPayload?.email || primaryEmail || '',
    avatarUrl: userPayload?.avatar_url || '',
    profileUrl: userPayload?.html_url || ''
  });
}

export async function getGithubAuthStatus({ workspaceRoot, authInfo } = {}) {
  const setup = await getGithubSetup(workspaceRoot);
  const state = await loadState(workspaceRoot);
  const storedToken = await getStoredGitToken({ workspaceRoot, authInfo });
  const nextState = state?.connection
    ? { ...state, connection: { ...state.connection, accessToken: storedToken } }
    : state;
  return buildStatusPayload(setup, nextState, { tokenStored: Boolean(storedToken) });
}

export async function beginGithubDeviceFlow({ workspaceRoot, authInfo } = {}) {
  const setup = await getGithubSetup(workspaceRoot);
  if (!setup.configured) {
    return {
      ok: false,
      message: 'GitHub device flow is not configured.'
    };
  }

  const state = await loadState(workspaceRoot);
  const storedToken = await getStoredGitToken({ workspaceRoot, authInfo });
  const connectionSource = String(state?.connection?.source || '').trim().toLowerCase();
  const hasGithubConnection = Boolean(state.connection && connectionSource === 'github' && storedToken);
  if (hasGithubConnection) {
    return buildStatusPayload(setup, {
      ...state,
      connection: { ...state.connection, accessToken: storedToken }
    }, { tokenStored: Boolean(storedToken) });
  }

  const currentPending = sanitizePending(state.pending);
  if (currentPending) {
    return buildStatusPayload(setup, { ...state, pending: currentPending }, { tokenStored: Boolean(storedToken) });
  }

  const payload = await postGitHubForm(GITHUB_DEVICE_CODE_URL, {
    client_id: setup.clientId,
    scope: setup.scope
  });

  const nextState = {
    pending: sanitizePending({
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri || 'https://github.com/login/device',
      verificationUriComplete: payload.verification_uri_complete || '',
      interval: payload.interval,
      expiresAt: Date.now() + (Number(payload.expires_in || 900) * 1000),
      createdAt: Date.now()
    }),
    connection: null
  };

  await saveState(workspaceRoot, nextState);
  return buildStatusPayload(setup, nextState, { tokenStored: Boolean(storedToken) });
}

export async function pollGithubDeviceFlow({ workspaceRoot, authInfo } = {}) {
  const setup = await getGithubSetup(workspaceRoot);
  if (!setup.configured) {
    return {
      ok: false,
      message: 'GitHub device flow is not configured.'
    };
  }

  const state = await loadState(workspaceRoot);
  const pending = sanitizePending(state.pending);
  const storedToken = await getStoredGitToken({ workspaceRoot, authInfo });

  if (state.connection && !pending && storedToken) {
    return buildStatusPayload(setup, {
      ...state,
      connection: { ...state.connection, accessToken: storedToken }
    }, { tokenStored: Boolean(storedToken) });
  }

  if (!pending) {
    return buildStatusPayload(setup, state, { tokenStored: Boolean(storedToken) });
  }

  const payload = await postGitHubForm(GITHUB_ACCESS_TOKEN_URL, {
    client_id: setup.clientId,
    device_code: pending.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  }).catch((error) => ({ error: error?.message || String(error) }));

  const rawError = String(payload?.error || '').trim();
  if (rawError) {
    if (rawError === 'authorization_pending') {
      return buildStatusPayload(setup, state, { tokenStored: Boolean(storedToken) });
    }
    if (rawError === 'slow_down') {
      const nextPending = {
        ...pending,
        interval: Math.max(
          pending.interval + 5,
          Number.parseInt(String(payload?.interval || '0'), 10) || 0
        )
      };
      const nextState = { ...state, pending: nextPending };
      await saveState(workspaceRoot, nextState);
      return buildStatusPayload(setup, nextState, { tokenStored: Boolean(storedToken) });
    }
    if (rawError === 'expired_token' || rawError === 'access_denied' || rawError === 'incorrect_device_code') {
      const nextState = { pending: null, connection: null };
      await saveState(workspaceRoot, nextState);
      return buildStatusPayload(setup, nextState, { tokenStored: false });
    }
    return {
      ok: false,
      message: payload?.error_description || rawError || 'GitHub device authorization failed.'
    };
  }

  const accessToken = String(payload?.access_token || '').trim();
  if (!accessToken) {
    return buildStatusPayload(setup, state);
  }

  const user = await fetchGithubUserProfile(accessToken);
  const now = Date.now();
  const nextState = {
    pending: null,
    connection: sanitizeConnection({
      provider: 'github',
      accessToken: '',
      tokenType: payload?.token_type || 'bearer',
      scope: payload?.scope || setup.scope,
      source: 'github',
      user,
      connectedAt: state.connection?.connectedAt || now,
      updatedAt: now
    })
  };

  await putStoredGitToken({ workspaceRoot, authInfo, token: accessToken });
  await saveState(workspaceRoot, nextState);
  return buildStatusPayload(setup, nextState, { tokenStored: true });
}

export async function disconnectGithubAuth({ workspaceRoot, authInfo } = {}) {
  const setup = await getGithubSetup(workspaceRoot);
  const nextState = {
    pending: null,
    connection: null
  };
  await deleteStoredGitToken({ workspaceRoot, authInfo });
  await saveState(workspaceRoot, nextState);
  return buildStatusPayload(setup, nextState, { tokenStored: false });
}

export async function getGithubAuthAccessToken({ workspaceRoot, authInfo } = {}) {
  return getStoredGitToken({ workspaceRoot, authInfo });
}

export async function storeManualGitAuthToken({ workspaceRoot, authInfo, token } = {}) {
  const clean = String(token || '').trim();
  if (!clean) {
    throw new Error('Token is required.');
  }
  await putStoredGitToken({ workspaceRoot, authInfo, token: clean });
  const setup = await getGithubSetup(workspaceRoot);
  const state = await loadState(workspaceRoot);
  const nextState = {
    ...state,
    pending: null,
    connection: sanitizeConnection({
      provider: 'github',
      accessToken: '',
      tokenType: 'bearer',
      scope: '',
      source: 'token',
      user: {},
      connectedAt: state.connection?.connectedAt || Date.now(),
      updatedAt: Date.now()
    })
  };
  await saveState(workspaceRoot, nextState);
  return buildStatusPayload(setup, nextState);
}
