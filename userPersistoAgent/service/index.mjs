#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateUserPassword, findUserByEmail, findUserById } from '../lib/users.mjs';
import { startEmailCodeLogin, verifyEmailCode } from '../lib/auth/email-code.mjs';
import { startPasskeyLogin, verifyPasskeyLogin, verifyPasskeyRegistration } from '../lib/auth/passkey.mjs';
import { verifyTotp } from '../lib/auth/totp.mjs';
import { handleStripeWebhook } from '../lib/billing/stripe.mjs';
import {
  createSsoAuthCode,
  createSsoLoginRequest,
  consumeSsoAuthCode,
  switchSsoLoginRequestClient
} from '../lib/sso-flow.mjs';
import { USERPERSISTO_AUTH_CLIENT_IDS, normalizeAuthClientId, userCanAccessClient } from '../lib/auth-clients.mjs';
import { getAllowedAuthMethods } from '../lib/settings.mjs';
import { getUserPersistoStore } from '../lib/storage/persisto-store.mjs';

const HOST = process.env.USERPERSISTO_SERVICE_HOST || process.env.PLOINKY_AGENT_BIND_HOST || '0.0.0.0';
const PORT = parseRequiredPort(process.env.USERPERSISTO_SERVICE_PORT || process.env.PORT, 'USERPERSISTO_SERVICE_PORT');
const AGENT_SERVER_PORT = parseRequiredPort(process.env.USERPERSISTO_AGENTSERVER_PORT, 'USERPERSISTO_AGENTSERVER_PORT');
const PLOINKY_AGENT_MCP_PATH = normalizeServicePath(process.env.PLOINKY_AGENT_MCP_PATH, 'PLOINKY_AGENT_MCP_PATH');
const RUNTIME_SECRET = String(process.env.USERPERSISTO_RUNTIME_SECRET || '').trim();
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();
const GENERIC_LOGIN_ERROR = 'Unable to continue sign-in. Check your email address and try again.';
const GENERIC_CODE_ERROR = 'Unable to verify this sign-in code. Check the code and try again.';
const GENERIC_PASSWORD_ERROR = 'Unable to sign in. Check your username and password and try again.';
const AUTH_METHOD_LABELS = {
  password: 'Password',
  emailCode: 'Email Code',
  passkey: 'Passkey',
  totp: 'Authenticator (OTP)'
};
const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = String(process.env.PLOINKY_WORKSPACE_ROOT || process.env.WORKSPACE_PATH || '').trim();
const USERPERSISTO_REPO_DIR = WORKSPACE_ROOT
  ? path.join(WORKSPACE_ROOT, '.ploinky', 'repos', 'AchillesIDE', 'userPersistoAgent')
  : path.resolve(SERVICE_DIR, '..');
const AUTH_PUBLIC_DIR = path.join(USERPERSISTO_REPO_DIR, 'public', 'auth');
const EXPLORER_SHARED_DIR = WORKSPACE_ROOT
  ? path.join(WORKSPACE_ROOT, '.ploinky', 'repos', 'AchillesIDE', 'explorer', 'shared')
  : '';
const STATIC_ROUTES = [
  {
    prefix: '/auth/shared/webskel/',
    baseDir: EXPLORER_SHARED_DIR ? path.join(EXPLORER_SHARED_DIR, 'libs', 'webskel') : '',
    stripPrefix: '/auth/shared/webskel/'
  },
  {
    prefix: '/auth/shared/ui/',
    baseDir: EXPLORER_SHARED_DIR ? path.join(EXPLORER_SHARED_DIR, 'ui') : '',
    stripPrefix: '/auth/shared/ui/'
  },
  {
    prefix: '/auth/shared/icons/',
    baseDir: EXPLORER_SHARED_DIR ? path.join(EXPLORER_SHARED_DIR, '..', 'assets', 'icons') : '',
    stripPrefix: '/auth/shared/icons/'
  },
  {
    prefix: '/auth/',
    baseDir: AUTH_PUBLIC_DIR,
    stripPrefix: '/auth/'
  }
];

function parseRequiredPort(value, name) {
  const port = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return port;
}

function normalizeServicePath(value, name) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/')) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

function sendJson(res, statusCode, payload = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function requestOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (origin) return origin;
  const host = String(req.headers.host || '').trim();
  return host ? `http://${host}` : '';
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  }[ext] || 'application/octet-stream';
}

async function serveStaticFile(res, baseDir, relativePath) {
  if (!baseDir) {
    sendJson(res, 404, { ok: false, error: 'asset_base_not_configured' });
    return;
  }
  const decodedPath = decodeURIComponent(String(relativePath || '')).replace(/^\/+/, '');
  const normalizedPath = decodedPath || 'index.html';
  const absolutePath = path.resolve(baseDir, normalizedPath);
  const resolvedBase = path.resolve(baseDir);
  if (absolutePath !== resolvedBase && !absolutePath.startsWith(`${resolvedBase}${path.sep}`)) {
    sendJson(res, 403, { ok: false, error: 'asset_path_forbidden' });
    return;
  }
  const body = await fs.readFile(absolutePath);
  res.writeHead(200, {
    'Content-Type': mimeType(absolutePath),
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function serveAuthApp(res) {
  await serveStaticFile(res, AUTH_PUBLIC_DIR, 'index.html');
}

function serveSelfRegisteredApp(res) {
  const body = Buffer.from(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Self-registered account</title>
  <link rel="stylesheet" href="/public-services/userpersisto/auth/shared/ui/ui-common.css">
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--color-background, #f7f8fb);
      color: var(--color-text, #202533);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(520px, calc(100vw - 32px));
      display: grid;
      gap: 14px;
      padding: 24px;
      border: 1px solid var(--color-border, #d8dde8);
      border-radius: 8px;
      background: var(--color-surface, #fff);
    }
    h1 {
      margin: 0;
      font-size: 1.25rem;
      line-height: 1.2;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      line-height: 1.45;
      color: var(--color-text-muted, #5b6472);
    }
  </style>
</head>
<body>
  <main>
    <h1>Self-registered account</h1>
    <p>Your account is active. The self-registered application dashboard will be available here.</p>
  </main>
</body>
</html>`, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function serveAuthAsset(res, pathname) {
  for (const route of STATIC_ROUTES) {
    if (!pathname.startsWith(route.prefix)) continue;
    await serveStaticFile(res, route.baseDir, pathname.slice(route.stripPrefix.length));
    return true;
  }
  return false;
}

function requestClientId(body = {}, res = null) {
  try {
    return normalizeAuthClientId(body.clientId);
  } catch (error) {
    if (res) {
      sendJson(res, 400, { ok: false, error: error?.message || 'Invalid UserPersisto clientId.' });
      return '';
    }
    throw error;
  }
}

async function getUserAvailableAuthMethods(email, clientId) {
  const user = await findUserByEmail(email).catch(() => null);
  if (!user) {
    return { user: null, methods: [], accessAllowed: false };
  }
  const accessAllowed = userCanAccessClient(user, clientId);
  if (!accessAllowed) {
    return { user, methods: [], accessAllowed };
  }
  const allowedMethods = await getAllowedAuthMethods();
  const store = getUserPersistoStore();
  const rawUser = await store.selectOne('user', { id: user.id }).catch(() => null);
  const methods = [];
  if (clientId === USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP || allowedMethods.includes('emailCode')) {
    methods.push({ type: 'emailCode', name: AUTH_METHOD_LABELS.emailCode });
  }
  if (allowedMethods.includes('password') && rawUser?.passwordHash) {
    methods.push({ type: 'password', name: AUTH_METHOD_LABELS.password });
  }
  if (allowedMethods.includes('passkey')) {
    const credentials = await store.select('passkeyCredential', { userId: user.id }, { limit: 20 }).catch(() => []);
    for (const credential of credentials) {
      methods.push({
        type: 'passkey',
        id: credential.credentialId || credential.id,
        name: credential.name || AUTH_METHOD_LABELS.passkey
      });
    }
  }
  if (allowedMethods.includes('totp')) {
    const totp = await store.selectOne('totpSecret', { userId: user.id }).catch(() => null);
    if (totp?.enabledAt) {
      methods.push({ type: 'totp', name: AUTH_METHOD_LABELS.totp, enabled: true });
    }
  }
  return { user, methods, accessAllowed };
}

async function getSelectedAuthMethod(email, requestedMethod = '', clientId) {
  const { user, methods, accessAllowed } = await getUserAvailableAuthMethods(email, clientId);
  const preferredMethod = user?.preferredAuthMethod || '';
  const selected = methods.find((method) => method.type === requestedMethod)
    || methods.find((method) => method.type === preferredMethod)
    || methods[0]
    || null;
  return { user, methods, selectedMethod: selected?.type || '', accessAllowed };
}

function loginFailureKey(req, username) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = forwarded || req.socket?.remoteAddress || '';
  return `${remote}:${String(username || '').trim().toLowerCase()}`;
}

function assertLoginAllowed(key) {
  const record = loginFailures.get(key);
  if (!record) return;
  if (Date.now() - record.firstFailureAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return;
  }
  if (record.count >= LOGIN_MAX_FAILURES) {
    throw new Error('Too many failed login attempts. Try again later.');
  }
}

function recordLoginFailure(key) {
  const now = Date.now();
  const record = loginFailures.get(key);
  if (!record || now - record.firstFailureAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstFailureAt: now });
    return;
  }
  record.count += 1;
  loginFailures.set(key, record);
}

function clearLoginFailures(key) {
  loginFailures.delete(key);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function buildSsoCallbackLocation({ req, requestId, state, user }) {
  const authCode = await createSsoAuthCode({ providerState: requestId, userId: user.id });
  const callback = new URL(authCode.redirectUri, `http://${req.headers.host || '127.0.0.1'}`);
  callback.searchParams.set('code', authCode.code);
  callback.searchParams.set('state', state);
  return `${callback.pathname}${callback.search}`;
}

async function handlePasskeyStart(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  const body = await readJsonBody(req);
  const clientId = requestClientId(body, res);
  if (!clientId) return;
  const { user, methods } = await getSelectedAuthMethod(body.email || '', 'passkey', clientId);
  if (!user || !methods.some((method) => method.type === 'passkey')) {
    sendJson(res, 403, { ok: false, error: 'passkey_login_not_allowed' });
    return;
  }
  const result = await startPasskeyLogin({
    email: body.email || '',
    origin: requestOrigin(req)
  });
  sendJson(res, 200, result);
}

async function handlePasskeyVerify(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  const body = await readJsonBody(req);
  const clientId = requestClientId(body, res);
  if (!clientId) return;
  const { user: expectedUser, methods } = await getSelectedAuthMethod(body.email || '', 'passkey', clientId);
  if (!expectedUser || !methods.some((method) => method.type === 'passkey')) {
    sendJson(res, 403, { ok: false, error: 'passkey_login_not_allowed' });
    return;
  }
  const result = await verifyPasskeyLogin({
    credential: body.credential,
    origin: req.headers.origin || ''
  });
  const user = result.user;
  if (!user || user.id !== expectedUser.id || !userCanAccessClient(user, clientId)) {
    sendJson(res, 403, { ok: false, error: 'user_not_allowed' });
    return;
  }
  const redirectUrl = await buildSsoCallbackLocation({
    req,
    requestId: body.requestId || '',
    state: body.state || '',
    user
  });
  sendJson(res, 200, { ok: true, redirectUrl });
}

async function handlePasskeyRegistrationVerify(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  const body = await readJsonBody(req);
  const result = await verifyPasskeyRegistration({ credential: body.credential });
  sendJson(res, 200, result);
}

function requirePost(req, res) {
  if (req.method === 'POST') return true;
  res.writeHead(405, { 'Cache-Control': 'no-store' });
  res.end();
  return false;
}

function publicLoginErrorFor(kind) {
  if (kind === 'emailCode') return GENERIC_CODE_ERROR;
  if (kind === 'password') return GENERIC_PASSWORD_ERROR;
  return GENERIC_LOGIN_ERROR;
}

function requestAuthMode(body = {}, res = null) {
  const mode = String(body.mode || '').trim();
  if (mode === 'login' || mode === 'signup') return mode;
  if (res) {
    sendJson(res, 400, { ok: false, error: 'UserPersisto auth mode must be login or signup.' });
    return '';
  }
  throw new Error('UserPersisto auth mode must be login or signup.');
}

async function handleMethodsApi(req, res) {
  if (!requirePost(req, res)) return;
  const body = await readJsonBody(req);
  const email = String(body.email || '').trim();
  const clientId = requestClientId(body, res);
  if (!clientId) return;
  const failureKey = loginFailureKey(req, email);
  try {
    assertLoginAllowed(failureKey);
    let { user, methods, selectedMethod, accessAllowed } = await getSelectedAuthMethod(email, '', clientId);
    if (user && !accessAllowed && userCanAccessClient(user, USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP)) {
      const signupRequest = await switchSsoLoginRequestClient({
        providerState: body.requestId || '',
        clientId: USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP
      });
      ({ user, methods, selectedMethod } = await getSelectedAuthMethod(email, '', signupRequest.clientId));
      sendJson(res, 200, {
        ok: true,
        userExists: true,
        clientId: signupRequest.clientId,
        user: {
          id: user.id,
          email: user.email,
          username: user.username || ''
        },
        methods,
        selectedMethod
      });
      return;
    }
    if (!user) {
      const signupRequest = await switchSsoLoginRequestClient({
        providerState: body.requestId || '',
        clientId: USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP
      });
      sendJson(res, 200, {
        ok: true,
        userExists: false,
        canSignup: true,
        clientId: signupRequest.clientId,
        methods: []
      });
      return;
    }
    if (!methods.length) throw new Error(GENERIC_LOGIN_ERROR);
    sendJson(res, 200, {
      ok: true,
      userExists: true,
      clientId,
      user: {
        id: user.id,
        email: user.email,
        username: user.username || ''
      },
      methods,
      selectedMethod
    });
  } catch (error) {
    recordLoginFailure(failureKey);
    console.warn('[UserPersisto] login method discovery failed:', error?.message || String(error));
    sendJson(res, 401, { ok: false, error: GENERIC_LOGIN_ERROR });
  }
}

async function handleEmailStartApi(req, res) {
  if (!requirePost(req, res)) return;
  const body = await readJsonBody(req);
  const email = String(body.email || '').trim();
  const clientId = requestClientId(body, res);
  if (!clientId) return;
  const mode = requestAuthMode(body, res);
  if (!mode) return;
  const failureKey = loginFailureKey(req, email);
  try {
    assertLoginAllowed(failureKey);
    let effectiveClientId = clientId;
    if (mode === 'signup') {
      if (clientId !== USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP) {
        sendJson(res, 403, { ok: false, error: 'signup_not_allowed_for_client' });
        return;
      }
      const existingUser = await findUserByEmail(email).catch(() => null);
      if (existingUser) {
        sendJson(res, 409, { ok: false, error: 'account_already_exists' });
        return;
      }
      await startEmailCodeLogin({ email, createSelfRegisteredUser: true });
    } else {
      let { user, methods, accessAllowed } = await getSelectedAuthMethod(email, 'emailCode', effectiveClientId);
      if (user && !accessAllowed && userCanAccessClient(user, USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP)) {
        const signupRequest = await switchSsoLoginRequestClient({
          providerState: body.requestId || '',
          clientId: USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP
        });
        effectiveClientId = signupRequest.clientId;
        ({ user, methods } = await getSelectedAuthMethod(email, 'emailCode', effectiveClientId));
      }
      if (!user || !methods.some((method) => method.type === 'emailCode')) {
        throw new Error(GENERIC_LOGIN_ERROR);
      }
      await startEmailCodeLogin({ email });
    }
    sendJson(res, 200, { ok: true, clientId: effectiveClientId });
  } catch (error) {
    recordLoginFailure(failureKey);
    console.warn('[UserPersisto] email code start failed:', error?.message || String(error));
    sendJson(res, 401, { ok: false, error: GENERIC_LOGIN_ERROR });
  }
}

async function handleEmailVerifyApi(req, res) {
  if (!requirePost(req, res)) return;
  const body = await readJsonBody(req);
  const email = String(body.email || '').trim();
  const clientId = requestClientId(body, res);
  if (!clientId) return;
  const mode = requestAuthMode(body, res);
  if (!mode) return;
  const failureKey = loginFailureKey(req, email);
  try {
    assertLoginAllowed(failureKey);
    let effectiveClientId = clientId;
    if (mode === 'signup') {
      if (clientId !== USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP) {
        throw new Error(GENERIC_CODE_ERROR);
      }
    } else {
      let { user, methods, accessAllowed } = await getSelectedAuthMethod(email, 'emailCode', effectiveClientId);
      if (user && !accessAllowed && userCanAccessClient(user, USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP)) {
        const signupRequest = await switchSsoLoginRequestClient({
          providerState: body.requestId || '',
          clientId: USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP
        });
        effectiveClientId = signupRequest.clientId;
        ({ user, methods } = await getSelectedAuthMethod(email, 'emailCode', effectiveClientId));
      }
      if (!user || !methods.some((method) => method.type === 'emailCode')) {
        throw new Error(GENERIC_CODE_ERROR);
      }
    }
    const result = await verifyEmailCode({ email, code: body.code || '' });
    const verifiedUser = result.user;
    if (!verifiedUser || !userCanAccessClient(verifiedUser, effectiveClientId)) {
      throw new Error(GENERIC_CODE_ERROR);
    }
    clearLoginFailures(failureKey);
    const redirectUrl = await buildSsoCallbackLocation({
      req,
      requestId: body.requestId || '',
      state: body.state || '',
      user: verifiedUser
    });
    sendJson(res, 200, { ok: true, redirectUrl });
  } catch (error) {
    recordLoginFailure(failureKey);
    console.warn('[UserPersisto] email code verify failed:', error?.message || String(error));
    sendJson(res, 401, { ok: false, error: GENERIC_CODE_ERROR });
  }
}

async function handlePasswordVerifyApi(req, res) {
  if (!requirePost(req, res)) return;
  const body = await readJsonBody(req);
  const email = String(body.email || '').trim();
  const username = String(body.username || '').trim();
  const clientId = requestClientId(body, res);
  if (!clientId) return;
  const failureKey = loginFailureKey(req, username || email);
  try {
    assertLoginAllowed(failureKey);
    const { user, methods } = await getSelectedAuthMethod(email, 'password', clientId);
    if (!user || !methods.some((method) => method.type === 'password')) {
      throw new Error(GENERIC_PASSWORD_ERROR);
    }
    const rawUser = await getUserPersistoStore().selectOne('user', { id: user.id });
    const authenticatedUser = await authenticateUserPassword({
      username: username || rawUser?.username || '',
      password: body.password || '',
      requireExplorerAccess: false
    });
    if (authenticatedUser.id !== user.id) throw new Error(GENERIC_PASSWORD_ERROR);
    clearLoginFailures(failureKey);
    const redirectUrl = await buildSsoCallbackLocation({
      req,
      requestId: body.requestId || '',
      state: body.state || '',
      user: authenticatedUser
    });
    sendJson(res, 200, { ok: true, redirectUrl });
  } catch (error) {
    recordLoginFailure(failureKey);
    console.warn('[UserPersisto] password verify failed:', error?.message || String(error));
    sendJson(res, 401, { ok: false, error: publicLoginErrorFor('password') });
  }
}

async function handleTotpVerifyApi(req, res) {
  if (!requirePost(req, res)) return;
  const body = await readJsonBody(req);
  const email = String(body.email || '').trim();
  const clientId = requestClientId(body, res);
  if (!clientId) return;
  const failureKey = loginFailureKey(req, email);
  try {
    assertLoginAllowed(failureKey);
    const { user, methods } = await getSelectedAuthMethod(email, 'totp', clientId);
    if (!user || !methods.some((method) => method.type === 'totp')) {
      throw new Error(GENERIC_LOGIN_ERROR);
    }
    await verifyTotp({ userId: user.id, code: body.token || '' });
    clearLoginFailures(failureKey);
    const redirectUrl = await buildSsoCallbackLocation({
      req,
      requestId: body.requestId || '',
      state: body.state || '',
      user
    });
    sendJson(res, 200, { ok: true, redirectUrl });
  } catch (error) {
    recordLoginFailure(failureKey);
    console.warn('[UserPersisto] totp verify failed:', error?.message || String(error));
    sendJson(res, 401, { ok: false, error: GENERIC_LOGIN_ERROR });
  }
}

async function handleLogin(req, res) {
  if (req.method === 'GET') {
    await serveAuthApp(res);
    return;
  }
  res.writeHead(405, { 'Cache-Control': 'no-store' });
  res.end();
}

async function handleRuntime(req, res, url) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  if (!RUNTIME_SECRET) {
    sendJson(res, 503, { ok: false, error: 'runtime_secret_not_configured' });
    return;
  }
  const providedSecret = String(req.headers['x-userpersisto-runtime-secret'] || '').trim();
  const expected = Buffer.from(RUNTIME_SECRET);
  const actual = Buffer.from(providedSecret);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    sendJson(res, 403, { ok: false, error: 'runtime_forbidden' });
    return;
  }
  const body = await readJsonBody(req);
  if (url.pathname === '/runtime/sso-login-request') {
    const clientId = requestClientId(body, res);
    if (!clientId) return;
    const request = await createSsoLoginRequest({ redirectUri: body.redirectUri || '', clientId });
    sendJson(res, 200, { ok: true, request });
    return;
  }
  if (url.pathname === '/runtime/sso-consume-code') {
    const result = await consumeSsoAuthCode({
      providerState: body.providerState || '',
      code: body.code || ''
    });
    sendJson(res, 200, { ok: true, user: result.user, clientId: result.clientId });
    return;
  }
  if (url.pathname === '/runtime/sso-user') {
    const clientId = requestClientId(body, res);
    if (!clientId) return;
    const user = await findUserById(body.userId || '');
    if (!user || !userCanAccessClient(user, clientId)) {
      sendJson(res, 403, { ok: false, error: 'user_not_allowed' });
      return;
    }
    sendJson(res, 200, { ok: true, user });
    return;
  }
  sendJson(res, 404, { ok: false, error: 'runtime_endpoint_not_found' });
}

async function handleStripeWebhookRequest(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  const rawBody = await readRawBody(req);
  const signature = String(req.headers['stripe-signature'] || '').trim();
  const result = await handleStripeWebhook({ rawBody, signature });
  sendJson(res, 200, result);
}

function proxyMcpToAgentServer(req, res, url) {
  const headers = { ...req.headers, host: `127.0.0.1:${AGENT_SERVER_PORT}` };
  delete headers.connection;
  delete headers['proxy-connection'];

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: AGENT_SERVER_PORT,
    method: req.method,
    path: `${PLOINKY_AGENT_MCP_PATH}${url.search || ''}`,
    headers
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    console.warn('[UserPersisto] MCP proxy failed:', error?.message || String(error));
    if (!res.headersSent) {
      sendJson(res, 502, { ok: false, error: 'mcp_proxy_unavailable' });
      return;
    }
    res.end();
  });

  req.pipe(proxyReq);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === PLOINKY_AGENT_MCP_PATH || url.pathname === `${PLOINKY_AGENT_MCP_PATH}/`) {
      proxyMcpToAgentServer(req, res, url);
      return;
    }
    if (url.pathname === '/auth/passkey/start') {
      await handlePasskeyStart(req, res);
      return;
    }
    if (url.pathname === '/auth/passkey/verify') {
      await handlePasskeyVerify(req, res);
      return;
    }
    if (url.pathname === '/auth/passkey/register') {
      await serveAuthApp(res);
      return;
    }
    if (url.pathname === '/auth/passkey/register/verify') {
      await handlePasskeyRegistrationVerify(req, res);
      return;
    }
    if (url.pathname === '/auth/api/methods') {
      await handleMethodsApi(req, res);
      return;
    }
    if (url.pathname === '/auth/api/email/start') {
      await handleEmailStartApi(req, res);
      return;
    }
    if (url.pathname === '/auth/api/email/verify') {
      await handleEmailVerifyApi(req, res);
      return;
    }
    if (url.pathname === '/auth/api/password/verify') {
      await handlePasswordVerifyApi(req, res);
      return;
    }
    if (url.pathname === '/auth/api/totp/verify') {
      await handleTotpVerifyApi(req, res);
      return;
    }
    if (url.pathname === '/auth/login') {
      await handleLogin(req, res, url);
      return;
    }
    if (url.pathname === '/selfregistered' || url.pathname === '/selfregistered/') {
      serveSelfRegisteredApp(res);
      return;
    }
    if (url.pathname.startsWith('/auth/')) {
      const served = await serveAuthAsset(res, url.pathname);
      if (served) return;
    }
    if (url.pathname.startsWith('/runtime/')) {
      await handleRuntime(req, res, url);
      return;
    }
    if (url.pathname === '/billing/stripe/webhook') {
      await handleStripeWebhookRequest(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'userpersisto_endpoint_not_found' });
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[UserPersisto] service listening on ${HOST}:${PORT}; MCP proxy to 127.0.0.1:${AGENT_SERVER_PORT}${PLOINKY_AGENT_MCP_PATH}`);
});
