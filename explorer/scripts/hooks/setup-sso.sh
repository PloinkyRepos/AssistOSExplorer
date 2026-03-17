#!/usr/bin/env bash
set -euo pipefail

mode="${1:-seed}"
workspace_root="${PLOINKY_CWD:-${PLOINKY_WORKSPACE_ROOT:-$PWD}}"

export PLOINKY_SSO_SETUP_MODE="$mode"
export PLOINKY_WORKSPACE_ROOT="$workspace_root"

node <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const mode = String(process.env.PLOINKY_SSO_SETUP_MODE || 'seed').trim().toLowerCase();
const workspaceRoot = path.resolve(process.env.PLOINKY_WORKSPACE_ROOT || process.cwd());
const ploinkyDir = path.join(workspaceRoot, '.ploinky');
const agentsFile = path.join(ploinkyDir, 'agents');
const secretsFile = path.join(ploinkyDir, '.secrets');
const routingFile = path.join(ploinkyDir, 'routing.json');
const manifestFile = path.join(ploinkyDir, 'repos', 'fileExplorer', 'explorer', 'manifest.json');

const DEFAULTS = {
  providerPort: 8180,
  realm: 'ploinky',
  clientId: 'ploinky-router',
  scope: 'openid profile email',
  adminUser: 'admin',
  adminPassword: 'admin',
  dbEngine: 'postgres',
  dbUrl: 'jdbc:postgresql://host.containers.internal:5432/postgres',
  dbUsername: 'postgres',
  dbPassword: 'postgres',
  testUser: 'admin',
  testPassword: 'admin',
  testEmail: 'admin@example.com',
  localUser: 'admin',
  localPassword: 'admin'
};
const manifest = readJson(manifestFile, {});

function parsePloinkyDirectives(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap((item) => parsePloinkyDirectives(item)).filter(Boolean);
  }
  if (typeof rawValue !== 'string') {
    return [];
  }
  return rawValue
    .split(/[,\n;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getManifestSsoDefaults() {
  return {
    user: String(manifest?.sso?.user ?? manifest?.sso?.username ?? DEFAULTS.testUser).trim() || DEFAULTS.testUser,
    password: String(manifest?.sso?.password ?? DEFAULTS.testPassword),
    email: String(manifest?.sso?.email ?? DEFAULTS.testEmail).trim() || DEFAULTS.testEmail
  };
}

function getManifestDefaultAuthMode() {
  const ploinkyDirectives = parsePloinkyDirectives(manifest?.ploinky);
  if (ploinkyDirectives.includes('pwd enable')) return 'local';
  if (ploinkyDirectives.includes('sso enable')) return 'sso';
  return 'none';
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function parseSecrets() {
  const map = {};
  try {
    const raw = fs.readFileSync(secretsFile, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      map[line.slice(0, idx).trim()] = line.slice(idx + 1);
    }
  } catch (_) {}
  return map;
}

function writeSecrets(map) {
  fs.mkdirSync(path.dirname(secretsFile), { recursive: true });
  const lines = ['# Ploinky secrets'];
  for (const [key, value] of Object.entries(map)) {
    lines.push(`${key}=${value ?? ''}`);
  }
  fs.writeFileSync(secretsFile, `${lines.join('\n')}\n`);
}

function getExplorerRecord(agents) {
  for (const [key, rec] of Object.entries(agents || {})) {
    if (key === '_config') continue;
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type !== 'agent') continue;
    if (String(rec.agentName || '').trim() !== 'explorer') continue;
    if (String(rec.repoName || '').trim() !== 'fileExplorer') continue;
    if (rec.alias) continue;
    return { key, rec };
  }
  return null;
}

function getExplorerAuthMode(agents) {
  const explorer = getExplorerRecord(agents);
  const explicitMode = String(explorer?.rec?.auth?.mode || '').trim().toLowerCase();
  if (explicitMode) return explicitMode;
  return getManifestDefaultAuthMode();
}

function shouldConfigure(agents) {
  const authMode = getExplorerAuthMode(agents);
  return authMode === 'sso' || authMode === 'local';
}

function getRouterPort(agents) {
  const cfgPort = Number(agents?._config?.static?.port || 0);
  if (Number.isFinite(cfgPort) && cfgPort > 0) return cfgPort;
  const routing = readJson(routingFile, {});
  const routingPort = Number(routing?.port || 0);
  if (Number.isFinite(routingPort) && routingPort > 0) return routingPort;
  return 8080;
}

function getProviderPort() {
  const routing = readJson(routingFile, {});
  const keycloakRoute = routing?.routes?.keycloak || null;
  const hostPort = Number(keycloakRoute?.hostPort || 0);
  if (Number.isFinite(hostPort) && hostPort > 0) return hostPort;
  return DEFAULTS.providerPort;
}

function ensureLocalConfig(agents, secrets, changed) {
  const explorer = getExplorerRecord(agents);
  if (!explorer) return;
  if (getExplorerAuthMode(agents) !== 'local') return;

  const userVar = String(explorer.rec?.auth?.userVar || 'PLOINKY_AUTH_EXPLORER_USER').trim();
  const passwordHashVar = String(explorer.rec?.auth?.passwordHashVar || 'PLOINKY_AUTH_EXPLORER_PASSWORD_HASH').trim();
  const passwordHash = `sha256:${crypto.createHash('sha256').update(DEFAULTS.localPassword, 'utf8').digest('hex')}`;

  const setIfMissing = (name, value) => {
    const existing = String(secrets[name] || '').trim();
    if (existing) return;
    secrets[name] = value;
    changed.push(name);
  };

  setIfMissing(userVar, DEFAULTS.localUser);
  setIfMissing(passwordHashVar, passwordHash);
}

function ensureSeedConfig() {
  const agents = readJson(agentsFile, {});
  if (!shouldConfigure(agents)) {
    console.log('[explorer-sso] skip seed: manifest/agent auth is not pwd/sso');
    return null;
  }

  const providerPort = getProviderPort();
  const routerPort = getRouterPort(agents);
  const baseUrl = `http://127.0.0.1:${providerPort}`;
  const redirectUri = `http://127.0.0.1:${routerPort}/auth/callback`;
  const logoutRedirectUri = `http://127.0.0.1:${routerPort}/auth/logged-out`;

  const secrets = parseSecrets();
  const changed = [];
  const setIfMissing = (name, value) => {
    const existing = String(secrets[name] || '').trim();
    if (existing) return;
    secrets[name] = value;
    changed.push(name);
  };

  const authMode = getExplorerAuthMode(agents);
  const manifestSsoDefaults = getManifestSsoDefaults();
  if (authMode === 'sso') {
    setIfMissing('SSO_BASE_URL', baseUrl);
    setIfMissing('SSO_REALM', DEFAULTS.realm);
    setIfMissing('SSO_CLIENT_ID', DEFAULTS.clientId);
    setIfMissing('SSO_SCOPE', DEFAULTS.scope);
    setIfMissing('SSO_REDIRECT_URI', redirectUri);
    setIfMissing('SSO_LOGOUT_REDIRECT_URI', logoutRedirectUri);
    setIfMissing('SSO_ADMIN', DEFAULTS.adminUser);
    setIfMissing('SSO_ADMIN_PASSWORD', DEFAULTS.adminPassword);
    setIfMissing('SSO_DB_ENGINE', DEFAULTS.dbEngine);
    setIfMissing('SSO_DB_URL', DEFAULTS.dbUrl);
    setIfMissing('SSO_DB_USERNAME', DEFAULTS.dbUsername);
    setIfMissing('SSO_DB_PASSWORD', DEFAULTS.dbPassword);
    setIfMissing('SSO_TEST_USER', manifestSsoDefaults.user);
    setIfMissing('SSO_TEST_PASSWORD', manifestSsoDefaults.password);
    setIfMissing('SSO_TEST_EMAIL', manifestSsoDefaults.email);
  }
  ensureLocalConfig(agents, secrets, changed);

  if (changed.length) {
    writeSecrets(secrets);
  }

  const nextAgents = { ...agents };
  if (authMode === 'sso') {
    nextAgents._config = {
      ...(nextAgents._config || {}),
      sso: {
        ...((nextAgents._config || {}).sso || {}),
        enabled: true,
        provider: 'keycloak',
        providerAgent: 'keycloak',
        providerAgentShort: 'keycloak',
        databaseAgent: 'postgres',
        databaseAgentShort: 'postgres',
        baseUrl,
        realm: DEFAULTS.realm,
        clientId: DEFAULTS.clientId,
        redirectUri,
        logoutRedirectUri,
        scope: DEFAULTS.scope
      }
    };
  } else if (nextAgents._config?.sso) {
    nextAgents._config = {
      ...(nextAgents._config || {}),
      sso: {
        ...nextAgents._config.sso,
        enabled: false
      }
    };
  }

  const explorer = getExplorerRecord(nextAgents);
  if (explorer) {
    if (authMode === 'sso') {
      explorer.rec.auth = { ...(explorer.rec.auth || {}), mode: 'sso' };
    } else if (authMode === 'local') {
      explorer.rec.auth = {
        ...(explorer.rec.auth || {}),
        mode: 'local',
        userVar: String(explorer.rec?.auth?.userVar || 'PLOINKY_AUTH_EXPLORER_USER').trim(),
        passwordHashVar: String(explorer.rec?.auth?.passwordHashVar || 'PLOINKY_AUTH_EXPLORER_PASSWORD_HASH').trim()
      };
    }
    nextAgents[explorer.key] = explorer.rec;
  }

  writeJson(agentsFile, nextAgents);
  console.log(`[explorer-sso] seeded workspace auth config${changed.length ? ` (${changed.join(', ')})` : ''}`);
  return {
    authMode,
    baseUrl,
    realm: DEFAULTS.realm,
    clientId: DEFAULTS.clientId,
    redirectUri,
    logoutRedirectUri,
    testUser: secrets.SSO_TEST_USER || manifestSsoDefaults.user,
    testPassword: secrets.SSO_TEST_PASSWORD || manifestSsoDefaults.password
  };
}

async function waitForReady(baseUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  const readyUrl = `${baseUrl}/realms/master/.well-known/openid-configuration`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(readyUrl);
      if (response.ok) return true;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

async function getAdminToken(baseUrl, username, password) {
  const body = new URLSearchParams({
    username,
    password,
    grant_type: 'password',
    client_id: 'admin-cli'
  });
  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) {
    throw new Error(`admin token request failed (${response.status})`);
  }
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error('admin token missing');
  }
  return payload.access_token;
}

async function kc(baseUrl, token, method, endpoint, body, okStatuses = [200, 201, 204]) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!okStatuses.includes(response.status)) {
    const text = await response.text();
    throw new Error(`${method} ${endpoint} failed (${response.status})${text ? `: ${text}` : ''}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

async function bootstrap() {
  const seeded = ensureSeedConfig();
  if (!seeded) return;
  if (seeded.authMode !== 'sso') {
    console.log('[explorer-sso] bootstrap skipped: manifest/agent auth is not sso');
    return;
  }

  const secrets = parseSecrets();
  const baseUrl = String(secrets.SSO_BASE_URL || seeded.baseUrl).replace(/\/+$/, '');
  const realm = String(secrets.SSO_REALM || seeded.realm || DEFAULTS.realm);
  const clientId = String(secrets.SSO_CLIENT_ID || seeded.clientId || DEFAULTS.clientId);
  const redirectUri = String(secrets.SSO_REDIRECT_URI || seeded.redirectUri);
  const logoutRedirectUri = String(secrets.SSO_LOGOUT_REDIRECT_URI || seeded.logoutRedirectUri);
  const adminUser = String(secrets.SSO_ADMIN || DEFAULTS.adminUser);
  const adminPassword = String(secrets.SSO_ADMIN_PASSWORD || DEFAULTS.adminPassword);
  const testUser = String(secrets.SSO_TEST_USER || DEFAULTS.testUser);
  const testPassword = String(secrets.SSO_TEST_PASSWORD || DEFAULTS.testPassword);
  const testEmail = String(secrets.SSO_TEST_EMAIL || DEFAULTS.testEmail);

  const ready = await waitForReady(baseUrl, 60000);
  if (!ready) {
    console.log(`[explorer-sso] provider not ready yet at ${baseUrl}; bootstrap skipped`);
    return;
  }

  const token = await getAdminToken(baseUrl, adminUser, adminPassword);

  let realmExists = true;
  try {
    await kc(baseUrl, token, 'GET', `/admin/realms/${encodeURIComponent(realm)}`);
  } catch (_) {
    realmExists = false;
  }
  if (!realmExists) {
    await kc(baseUrl, token, 'POST', '/admin/realms', {
      realm,
      enabled: true,
      displayName: realm,
      loginWithEmailAllowed: true,
      duplicateEmailsAllowed: false,
      resetPasswordAllowed: true,
      editUsernameAllowed: false
    }, [201]);
  }

  const clients = await kc(
    baseUrl,
    token,
    'GET',
    `/admin/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(clientId)}`
  );
  const clientPayload = {
    clientId,
    enabled: true,
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    implicitFlowEnabled: false,
    redirectUris: [redirectUri, logoutRedirectUri],
    webOrigins: ['+'],
    protocol: 'openid-connect',
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': logoutRedirectUri
    }
  };

  if (Array.isArray(clients) && clients[0]?.id) {
    await kc(
      baseUrl,
      token,
      'PUT',
      `/admin/realms/${encodeURIComponent(realm)}/clients/${clients[0].id}`,
      { ...clientPayload, id: clients[0].id },
      [204]
    );
  } else {
    await kc(
      baseUrl,
      token,
      'POST',
      `/admin/realms/${encodeURIComponent(realm)}/clients`,
      clientPayload,
      [201]
    );
  }

  const users = await kc(
    baseUrl,
    token,
    'GET',
    `/admin/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(testUser)}`
  );
  let userId = Array.isArray(users) && users[0]?.id ? users[0].id : null;
  if (!userId) {
    await kc(
      baseUrl,
      token,
      'POST',
      `/admin/realms/${encodeURIComponent(realm)}/users`,
      {
        username: testUser,
        enabled: true,
        email: testEmail,
        emailVerified: true,
        firstName: 'Test',
        lastName: 'User'
      },
      [201]
    );
    const createdUsers = await kc(
      baseUrl,
      token,
      'GET',
      `/admin/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(testUser)}`
    );
    userId = Array.isArray(createdUsers) && createdUsers[0]?.id ? createdUsers[0].id : null;
  }

  if (userId) {
    await kc(
      baseUrl,
      token,
      'PUT',
      `/admin/realms/${encodeURIComponent(realm)}/users/${userId}/reset-password`,
      {
        type: 'password',
        value: testPassword,
        temporary: false
      },
      [204]
    );
  }

  console.log(`[explorer-sso] bootstrap complete: realm=${realm}, client=${clientId}, user=${testUser}`);
}

(async () => {
  if (mode === 'seed') {
    ensureSeedConfig();
    return;
  }
  if (mode === 'bootstrap') {
    await bootstrap();
    return;
  }
  throw new Error(`Unknown mode '${mode}'`);
})().catch((error) => {
  console.error(`[explorer-sso] ${error.message}`);
  process.exit(1);
});
NODE
