import { normalizeAuthClientId } from '../lib/auth-clients.mjs';

function routerBaseUrl(config = {}) {
  const explicit = String(config.routerBaseUrl || config.publicBaseUrl || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = String(process.env.PLOINKY_ROUTER_PORT || process.env.ROUTER_PORT || process.env.PORT || '8080').trim();
  return `http://localhost:${port}`;
}

function userRoles(user) {
  const role = String(user?.role || '').trim();
  if (role === 'admin') return ['admin', 'user'];
  if (role === 'selfRegistered') return ['selfRegistered'];
  if (role === 'user') return ['user'];
  return ['user'];
}

function normalizeUser(user) {
  return {
    id: String(user.id || ''),
    sub: String(user.id || ''),
    username: String(user.username || user.email || ''),
    name: String(user.displayName || user.username || user.email || 'User'),
    email: String(user.email || ''),
    roles: userRoles(user),
    raw: {
      provider: 'userPersistoAgent',
      role: user.role,
      status: user.status
    }
  };
}

export function resolveProviderConfig({ providerConfig = {}, readValue } = {}) {
  const runtimeSecretName = String(providerConfig.runtimeSecretName || 'USERPERSISTO_RUNTIME_SECRET').trim();
  const clientId = normalizeAuthClientId(providerConfig.clientId);
  const runtimeSecret = String(
    (typeof readValue === 'function' ? readValue(runtimeSecretName) : '') ||
    ''
  ).trim();
  if (!runtimeSecret) {
    throw new Error(`UserPersisto runtime secret is not configured (${runtimeSecretName}).`);
  }
  return {
    routerBaseUrl: routerBaseUrl(providerConfig),
    loginPath: String(providerConfig.loginPath || '/public-services/userpersisto/auth/login').trim(),
    runtimePath: String(providerConfig.runtimePath || '/public-services/userpersisto/runtime').trim(),
    clientId,
    runtimeSecretName,
    runtimeSecret
  };
}

async function postRuntime(config, endpoint, payload = {}) {
  const baseUrl = routerBaseUrl(config);
  const runtimePath = String(config.runtimePath || '/public-services/userpersisto/runtime').replace(/\/+$/, '');
  const response = await fetch(new URL(`${runtimePath}/${endpoint}`, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.runtimeSecret ? { 'X-UserPersisto-Runtime-Secret': config.runtimeSecret } : {})
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`UserPersisto runtime returned non-JSON response (${response.status}).`);
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || `UserPersisto runtime failed with status ${response.status}.`);
  }
  return data;
}

export function createProvider({ getConfig }) {
  return {
    name: 'AchillesIDE/userPersistoAgent',

    async sso_begin_login({ redirectUri }) {
      const config = await getConfig();
      const clientId = normalizeAuthClientId(config.clientId);
      const { request } = await postRuntime(config, 'sso-login-request', { redirectUri, clientId });
      const loginUrl = new URL(config.loginPath || '/public-services/userpersisto/auth/login', routerBaseUrl(config));
      loginUrl.searchParams.set('requestId', request.providerState);
      loginUrl.searchParams.set('state', request.providerState);
      loginUrl.searchParams.set('clientId', clientId);
      return {
        authorizationUrl: loginUrl.toString(),
        providerState: request.providerState,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      };
    },

    async sso_handle_callback({ query, providerState }) {
      const config = await getConfig();
      const { user, clientId: sessionClientId } = await postRuntime(config, 'sso-consume-code', {
        providerState,
        code: query?.code
      });
      const clientId = normalizeAuthClientId(sessionClientId);
      const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
      return {
        user: normalizeUser(user),
        providerSession: {
          provider: 'AchillesIDE/userPersistoAgent',
          clientId,
          userId: user.id,
          username: user.username,
          email: user.email,
          tokens: {
            accessToken: `userpersisto:${user.id}:${Date.now()}`,
            tokenType: 'Bearer',
            scope: userRoles(user).join(' ')
          },
          expiresAt,
          refreshExpiresAt: Date.now() + 24 * 60 * 60 * 1000
        }
      };
    },

    async sso_refresh_session({ providerSession }) {
      const config = await getConfig();
      const clientId = normalizeAuthClientId(providerSession?.clientId);
      const { user } = await postRuntime(config, 'sso-user', {
        userId: providerSession?.userId || '',
        clientId
      });
      if (!user || user.status !== 'active') {
        throw new Error('UserPersisto session user is no longer allowed.');
      }
      return {
        user: normalizeUser(user),
        providerSession: {
          ...providerSession,
          clientId,
          username: user.username,
          email: user.email,
          tokens: {
            ...(providerSession?.tokens || {}),
            accessToken: `userpersisto:${user.id}:${Date.now()}`
          },
          expiresAt: Date.now() + 4 * 60 * 60 * 1000
        }
      };
    },

    async sso_logout({ postLogoutRedirectUri }) {
      return { redirectUrl: postLogoutRedirectUri || '/' };
    },

    invalidateCaches() {}
  };
}
