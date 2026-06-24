import { createAvatarSettingsStore } from './avatar-settings-store.mjs';
import { parseAuthInfoHeader } from '../onlyoffice/auth-info.mjs';

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

export function createAvatarSettingsHttpHandler({
  fs,
  path,
  workspaceRoot,
  env = process.env
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
      const requestBaseUrl = getRequestBaseUrl(req);

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
