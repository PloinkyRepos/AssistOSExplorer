import { createAvatarSettingsStore } from './avatar-settings-store.mjs';
import { parseAuthInfoHeader } from '../onlyoffice/auth-info.mjs';
import { createOnlyOfficeDpuClient } from '../onlyoffice/onlyoffice-dpu-client.mjs';

const PROFILE_FOLDER_NAME = 'profile';
const PROFILE_FILE_NAME = 'avatar-config.json';
const PROFILE_DOCUMENT_VERSION = 1;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function parseRoles(value) {
  return String(value || '')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
}

function getIdentity(req, authInfo = null) {
  const authUser = authInfo?.user && typeof authInfo.user === 'object' ? authInfo.user : {};
  const userId = String(authUser.id || req.headers['x-ploinky-user-id'] || '').trim();
  const username = String(authUser.username || req.headers['x-ploinky-user'] || '').trim();
  const roles = Array.isArray(authUser.roles) && authUser.roles.length > 0
    ? authUser.roles.map((role) => String(role || '').trim()).filter(Boolean)
    : parseRoles(req.headers['x-ploinky-user-roles']);
  return {
    userId,
    username,
    roles,
    isAdmin: roles.includes('admin') || username === 'admin' || userId === 'local:admin'
  };
}

function getAgentIdFromPath(pathname) {
  const prefix = '/avatar-settings/agents/';
  if (!pathname.startsWith(prefix)) return '';
  const suffix = pathname.slice(prefix.length);
  return decodeURIComponent(suffix.split('/')[0] || '').trim();
}

function getUserIdFromPath(pathname) {
  const prefix = '/avatar-settings/users/';
  if (!pathname.startsWith(prefix)) return '';
  return decodeURIComponent(pathname.slice(prefix.length).split('/')[0] || '').trim();
}

function getFallbackLetter(value) {
  const text = String(value || '').trim();
  if (!text) return '?';
  const match = text.match(/[a-zA-Z0-9]/);
  return String(match?.[0] || text[0] || '?').toUpperCase();
}

function getRequestBaseUrl(req) {
  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    return origin.replace(/\/+$/, '');
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  if (!host) {
    return '';
  }
  const proto = String(req.headers['x-forwarded-proto'] || 'http').trim() || 'http';
  return `${proto}://${host}`;
}

async function callDpuTool(client, toolName, args = {}) {
  const parsed = await client.callTool(toolName, args);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid DPU response for ${toolName}.`);
  }
  if (parsed.ok === false) {
    throw new Error(parsed.error || `DPU call failed: ${toolName}`);
  }
  return parsed;
}

async function findDpuProfileObjects(client, { createMissing = false } = {}) {
  const roots = await callDpuTool(client, 'dpu_workspace_roots');
  const mySpaceRootId = roots?.roots?.mySpace?.id || '';
  if (!mySpaceRootId) {
    throw new Error('DPU My Space root is unavailable.');
  }
  const rootListing = await callDpuTool(client, 'dpu_confidential_list', { scope: 'my-space' });
  const rootItems = Array.isArray(rootListing.items) ? rootListing.items : [];
  let profileFolder = rootItems.find((item) => item?.name === PROFILE_FOLDER_NAME && item?.type === 'folder');
  if (!profileFolder && createMissing) {
    const created = await callDpuTool(client, 'dpu_confidential_create', {
      type: 'folder',
      name: PROFILE_FOLDER_NAME,
      parentId: mySpaceRootId
    });
    profileFolder = created.object;
  }
  if (!profileFolder) {
    return { profileFolder: null, avatarFile: null };
  }
  const profileListing = await callDpuTool(client, 'dpu_confidential_list', {
    scope: 'my-space',
    parentId: profileFolder.id
  });
  const profileItems = Array.isArray(profileListing.items) ? profileListing.items : [];
  const avatarFile = profileItems.find((item) => item?.name === PROFILE_FILE_NAME && item?.type === 'file');
  return { profileFolder, avatarFile };
}

function normalizeProfileDocument(raw, store, defaultConfig) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      enabled: true,
      config: defaultConfig
    };
  }
  const enabled = raw.enabled !== false;
  return {
    enabled,
    config: store.normalizeAxiFaceConfig({
      ...(raw.config && typeof raw.config === 'object' ? raw.config : {}),
      agentId: defaultConfig.agentId,
      seed: raw.config?.seed || defaultConfig.seed
    })
  };
}

async function loadProfileAvatarFromDpu(client, store, defaultConfig) {
  const { avatarFile } = await findDpuProfileObjects(client);
  if (!avatarFile?.id) {
    return {
      enabled: true,
      config: defaultConfig,
      found: false
    };
  }
  const fetched = await callDpuTool(client, 'dpu_confidential_get', { id: avatarFile.id });
  try {
    return {
      ...normalizeProfileDocument(JSON.parse(fetched.object?.content || '{}'), store, defaultConfig),
      found: true
    };
  } catch {
    return {
      enabled: true,
      config: defaultConfig,
      found: false
    };
  }
}

async function saveProfileAvatarToDpu(client, profile) {
  const content = JSON.stringify({
    version: PROFILE_DOCUMENT_VERSION,
    enabled: profile.enabled !== false,
    config: profile.config
  }, null, 2);
  const { profileFolder, avatarFile } = await findDpuProfileObjects(client, { createMissing: true });
  if (!profileFolder?.id) {
    throw new Error('DPU profile folder could not be created.');
  }
  if (avatarFile?.id) {
    await callDpuTool(client, 'dpu_confidential_update', {
      id: avatarFile.id,
      content,
      mimeType: 'application/json'
    });
    return;
  }
  await callDpuTool(client, 'dpu_confidential_create', {
    type: 'file',
    name: PROFILE_FILE_NAME,
    parentId: profileFolder.id,
    content,
    mimeType: 'application/json'
  });
}

function buildProfileAvatarResponse({ identity, userKey, profile, source }) {
  const enabled = profile.enabled !== false;
  const fallbackLetter = getFallbackLetter(identity.username || userKey);
  return {
    ok: true,
    user: {
      id: userKey,
      username: identity.username,
      roles: identity.roles,
      canManageAgents: identity.isAdmin
    },
    enabled,
    config: profile.config,
    fallbackLetter,
    source,
    avatar: {
      enabled,
      config: profile.config,
      fallbackLetter,
      source
    }
  };
}

async function resolveCurrentProfileAvatar({ identity, userKey, client, store }) {
  const defaultConfig = store.createDefaultAvatarConfig(`profile:${userKey}`, {
    size: '72'
  });
  const source = {
    kind: 'fallback',
    path: `${PROFILE_FOLDER_NAME}/${PROFILE_FILE_NAME}`
  };
  try {
    const profile = await loadProfileAvatarFromDpu(client, store, defaultConfig);
    source.kind = profile.found ? 'dpu' : 'fallback';
    return buildProfileAvatarResponse({
      identity,
      userKey,
      profile,
      source
    });
  } catch (error) {
    return buildProfileAvatarResponse({
      identity,
      userKey,
      profile: {
        enabled: true,
        config: defaultConfig
      },
      source: {
        kind: 'error',
        path: `${PROFILE_FOLDER_NAME}/${PROFILE_FILE_NAME}`,
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

export function createAvatarSettingsHttpHandler({
  fs,
  path,
  workspaceRoot,
  env = process.env,
  createDpuClient = createOnlyOfficeDpuClient
}) {
  const store = createAvatarSettingsStore({ fs, path, workspaceRoot });

  return async function handleAvatarSettingsHttpRequest(req, res, parsedUrl) {
    const pathname = parsedUrl.pathname || '/';
    if (!pathname.startsWith('/avatar-settings/')) {
      return false;
    }

    try {
      const authInfo = parseAuthInfoHeader(req.headers);
      if (!authInfo) {
        return sendJson(res, 401, { ok: false, error: 'Authentication is required for avatar settings.' });
      }
      const identity = getIdentity(req, authInfo);
      const userKey = identity.userId || identity.username || 'current-user';
      const requestBaseUrl = getRequestBaseUrl(req);
      if (req.method === 'GET' && pathname === '/avatar-settings/me') {
        const client = createDpuClient({ workspaceRoot, authInfo, env });
        try {
          const payload = await resolveCurrentProfileAvatar({ identity, userKey, client, store });
          return sendJson(res, 200, payload);
        } finally {
          await client.close?.();
        }
      }

      if (req.method === 'PATCH' && pathname === '/avatar-settings/me') {
        const body = await readJsonBody(req);
        const client = createDpuClient({ workspaceRoot, authInfo, env });
        try {
          const profileAvatar = await store.validateAxiFaceConfig({
            ...(body.config || body),
            agentId: `profile:${userKey}`,
            seed: body?.config?.seed || body?.seed || `profile:${userKey}`
          }, {
            assetBaseUrl: requestBaseUrl,
            fs: fs?.promises || fs,
            path,
            workspaceRoot,
            env
          });
          const profile = {
            enabled: body.enabled !== false,
            config: profileAvatar
          };
          await saveProfileAvatarToDpu(client, profile);
          return sendJson(res, 200, buildProfileAvatarResponse({
            identity,
            userKey,
            profile,
            source: {
              kind: 'dpu',
              path: `${PROFILE_FOLDER_NAME}/${PROFILE_FILE_NAME}`
            }
          }));
        } finally {
          await client.close?.();
        }
      }

      if (req.method === 'GET' && pathname.startsWith('/avatar-settings/users/')) {
        const requestedUserId = getUserIdFromPath(pathname);
        if (!requestedUserId) {
          return sendJson(res, 400, { ok: false, error: 'User id is required.' });
        }
        const currentAliases = new Set([
          userKey,
          identity.userId,
          identity.username,
          'me',
          'current-user'
        ].filter(Boolean));
        if (!currentAliases.has(requestedUserId)) {
          return sendJson(res, 403, {
            ok: false,
            error: 'Avatar for this user is not safely resolvable in the current session.'
          });
        }
        const client = createDpuClient({ workspaceRoot, authInfo, env });
        try {
          const payload = await resolveCurrentProfileAvatar({ identity, userKey, client, store });
          return sendJson(res, 200, payload);
        } finally {
          await client.close?.();
        }
      }

      if (req.method === 'GET' && pathname === '/avatar-settings/agents') {
        const agents = await store.listAgents();
        return sendJson(res, 200, {
          ok: true,
          canManageAgents: identity.isAdmin,
          agents
        });
      }

      if (req.method === 'PATCH' && pathname.startsWith('/avatar-settings/agents/')) {
        if (!identity.isAdmin) {
          return sendJson(res, 403, { ok: false, error: 'Only admins can update agent avatars.' });
        }
        const agentId = getAgentIdFromPath(pathname);
        const body = await readJsonBody(req);
        if (pathname.endsWith('/visibility')) {
          const result = await store.setAgentVisibility(agentId, body.enabled !== false);
          return sendJson(res, 200, { ok: true, agent: result });
        }
        const config = await store.updateAgent(agentId, body.config || body, {
          assetBaseUrl: requestBaseUrl,
          env
        });
        return sendJson(res, 200, { ok: true, agent: { id: agentId, config } });
      }

      return sendJson(res, 404, { ok: false, error: 'Avatar settings route not found.' });
    } catch (error) {
      return sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}
