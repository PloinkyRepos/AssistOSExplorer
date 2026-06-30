import crypto from 'node:crypto';
import { getUserPersistoStore } from './storage/persisto-store.mjs';
import { findUserById } from './users.mjs';
import { assertUserCanAccessClient, normalizeAuthClientId } from './auth-clients.mjs';

const LOGIN_REQUEST_TTL_MS = 5 * 60 * 1000;
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
const loginRequests = new Map();
const authCodes = new Map();

function requiredSecret() {
  const secret = String(process.env.USERPERSISTO_SETTINGS_SECRET || '').trim();
  if (!secret) {
    throw new Error('USERPERSISTO_SETTINGS_SECRET is required for SSO codes.');
  }
  return secret;
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso(ttlMs) {
  return new Date(Date.now() + ttlMs).toISOString();
}

function hashCode(code) {
  return crypto
    .createHash('sha256')
    .update(`${code}:${requiredSecret()}`)
    .digest('hex');
}

function assertActive(record, label) {
  if (!record || record.consumedAt) {
    throw new Error(`${label} is invalid or already used.`);
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw new Error(`${label} expired.`);
  }
}

export async function createSsoLoginRequest({ redirectUri = '', clientId } = {}) {
  const normalizedRedirectUri = String(redirectUri || '').trim();
  if (!normalizedRedirectUri) {
    throw new Error('redirectUri is required.');
  }
  const providerState = crypto.randomBytes(24).toString('base64url');
  const normalizedClientId = normalizeAuthClientId(clientId);
  const request = {
    id: crypto.randomUUID(),
    providerState,
    clientId: normalizedClientId,
    redirectUri: normalizedRedirectUri,
    expiresAt: expiresAtIso(LOGIN_REQUEST_TTL_MS),
    consumedAt: '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  loginRequests.set(providerState, request);
  await getUserPersistoStore().create('ssoLoginRequest', request).catch(() => null);
  return { providerState, clientId: request.clientId, expiresAt: request.expiresAt };
}

export async function switchSsoLoginRequestClient({ providerState, clientId } = {}) {
  const state = String(providerState || '').trim();
  if (!state) throw new Error('providerState is required.');
  const normalizedClientId = normalizeAuthClientId(clientId);
  const request = loginRequests.get(state) || await getUserPersistoStore().selectOne('ssoLoginRequest', { providerState: state });
  assertActive(request, 'Login request');
  request.clientId = normalizedClientId;
  request.updatedAt = nowIso();
  loginRequests.set(state, request);
  await getUserPersistoStore().update('ssoLoginRequest', request.id, {
    clientId: request.clientId,
    updatedAt: request.updatedAt
  }).catch(() => null);
  return { providerState: request.providerState, clientId: request.clientId, expiresAt: request.expiresAt };
}

export async function createSsoAuthCode({ providerState, userId }) {
  const state = String(providerState || '').trim();
  const id = String(userId || '').trim();
  if (!state) throw new Error('providerState is required.');
  if (!id) throw new Error('userId is required.');
  const request = loginRequests.get(state) || await getUserPersistoStore().selectOne('ssoLoginRequest', { providerState: state });
  assertActive(request, 'Login request');
  request.consumedAt = nowIso();
  loginRequests.set(state, request);
  await getUserPersistoStore().update('ssoLoginRequest', request.id, { consumedAt: request.consumedAt }).catch(() => null);
  const code = crypto.randomBytes(32).toString('base64url');
  const record = {
    id: crypto.randomUUID(),
    providerState: state,
    clientId: request.clientId,
    codeHash: hashCode(code),
    userId: id,
    expiresAt: expiresAtIso(AUTH_CODE_TTL_MS),
    consumedAt: '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  authCodes.set(`${state}:${record.codeHash}`, record);
  await getUserPersistoStore().create('ssoAuthCode', record).catch(() => null);
  return {
    code,
    redirectUri: request.redirectUri,
    clientId: request.clientId
  };
}

export async function consumeSsoAuthCode({ providerState, code }) {
  const state = String(providerState || '').trim();
  const value = String(code || '').trim();
  if (!state || !value) throw new Error('Missing SSO code.');
  const codeHash = hashCode(value);
  const inMemoryRecord = authCodes.get(`${state}:${codeHash}`);
  const records = inMemoryRecord
    ? [inMemoryRecord]
    : await getUserPersistoStore().select('ssoAuthCode', { providerState: state }, { limit: 100 });
  const record = records
    .filter((entry) => entry.codeHash === codeHash)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  assertActive(record, 'SSO code');
  record.consumedAt = nowIso();
  authCodes.set(`${state}:${codeHash}`, record);
  await getUserPersistoStore().update('ssoAuthCode', record.id, { consumedAt: record.consumedAt }).catch(() => null);
  const user = await findUserById(record.userId);
  assertUserCanAccessClient(user, record.clientId);
  return { user, clientId: record.clientId };
}
