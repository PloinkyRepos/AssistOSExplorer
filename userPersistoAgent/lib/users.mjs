import crypto from 'node:crypto';
import { getUserPersistoStore } from './storage/persisto-store.mjs';
import { assertRole, roleCanAccessExplorer, USERPERSISTO_ROLES } from './roles.mjs';
import { hashPassword, verifyPasswordHash } from './local-auth-passwords.mjs';
import { getAllowedAuthMethods } from './settings.mjs';

const AUTH_METHODS = new Set(['password', 'emailCode', 'passkey', 'totp']);

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error('A valid email is required.');
  }
  return value;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username || '',
    displayName: user.displayName || '',
    role: user.role,
    status: user.status || 'active',
    preferredAuthMethod: user.preferredAuthMethod || '',
    explorerAccess: roleCanAccessExplorer(user.role) && (user.status || 'active') === 'active',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export async function getCurrentUser(auth = {}) {
  const email = typeof auth.email === 'string' ? auth.email : '';
  if (!email) {
    return { authenticated: false, user: null };
  }
  const user = await findUserByEmail(email);
  return { authenticated: Boolean(user), user };
}

function normalizeUsername(value, defaultUsername = '') {
  const username = String(value || defaultUsername || '').trim();
  if (!username) return '';
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(username)) {
    throw new Error('Username must be 2-64 characters and use only letters, numbers, dot, underscore, or dash.');
  }
  return username;
}

export async function createUser(input = {}) {
  const store = getUserPersistoStore();
  const email = normalizeEmail(input.email);
  const existing = await store.findOne('user', (user) => String(user.email || '').toLowerCase() === email);
  if (existing) {
    throw new Error(`User ${email} already exists.`);
  }
  const role = assertRole(input.role);
  const username = normalizeUsername(input.username, roleCanAccessExplorer(role) ? email.split('@')[0] : '');
  const password = String(input.password || '');
  const user = await store.create('user', {
    id: input.id || crypto.randomUUID(),
    email,
    username,
    passwordHash: password ? hashPassword(password) : '',
    rev: 1,
    displayName: String(input.displayName || email.split('@')[0]).trim(),
    preferredAuthMethod: '',
    role,
    status: String(input.status || 'active').trim() || 'active'
  });
  await store.appendAudit('user.create', { targetType: 'user', targetId: user.id, metadata: { email, role } });
  return publicUser(user);
}

export async function updateUser(input = {}) {
  const store = getUserPersistoStore();
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const patch = {};
  if (input.displayName !== undefined) patch.displayName = String(input.displayName || '').trim();
  if (input.status !== undefined) patch.status = String(input.status || '').trim() || 'active';
  if (input.username !== undefined) patch.username = normalizeUsername(input.username);
  if (input.password !== undefined && String(input.password || '')) {
    patch.passwordHash = hashPassword(input.password);
    patch.rev = Date.now();
  }
  const user = await store.update('user', userId, patch);
  await store.appendAudit('user.update', { targetType: 'user', targetId: userId, metadata: patch });
  return publicUser(user);
}

export async function listUsers(input = {}) {
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.floor(input.limit))) : 100;
  const query = String(input.query || '').trim().toLowerCase();
  const rows = await getUserPersistoStore().select('user', {}, { sortBy: 'email', limit: 1000 });
  const users = rows
    .filter((user) => !query || user.email?.toLowerCase().includes(query) || user.displayName?.toLowerCase().includes(query))
    .slice(0, limit)
    .map(publicUser);
  return { users, roles: USERPERSISTO_ROLES };
}

export async function setUserRole(input = {}) {
  const store = getUserPersistoStore();
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const role = assertRole(input.role);
  const user = await store.update('user', userId, { role });
  await store.appendAudit('user.role.set', { targetType: 'user', targetId: userId, metadata: { role } });
  return publicUser(user);
}

export async function setUserPreferredAuthMethod(input = {}) {
  const store = getUserPersistoStore();
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const preferredAuthMethod = String(input.preferredAuthMethod || '').trim();
  if (!AUTH_METHODS.has(preferredAuthMethod)) {
    throw new Error('Invalid preferred authentication method.');
  }
  const user = await store.update('user', userId, { preferredAuthMethod });
  await store.appendAudit('user.auth.preferred.set', {
    targetType: 'user',
    targetId: userId,
    metadata: { preferredAuthMethod }
  });
  return publicUser(user);
}

function getAuthInfoUser(authInfo = null) {
  return authInfo?.user && typeof authInfo.user === 'object' ? authInfo.user : null;
}

export async function findCurrentUserFromAuthInfo(authInfo = null) {
  const authUser = getAuthInfoUser(authInfo);
  if (!authUser) return null;
  const email = String(authUser.email || '').trim();
  if (email) {
    const byEmail = await findUserByEmail(email).catch(() => null);
    if (byEmail) return byEmail;
  }
  const id = String(authUser.id || '').trim();
  if (id) {
    const byId = await findUserById(id).catch(() => null);
    if (byId) return byId;
  }
  const username = String(authUser.username || '').trim();
  if (username) {
    return publicUser(await getUserPersistoStore().selectOne('user', { username }));
  }
  return null;
}

export async function setCurrentUserPreferredAuthMethod(input = {}, authInfo = null) {
  const user = await findCurrentUserFromAuthInfo(authInfo);
  if (!user) {
    throw new Error('Authenticated UserPersisto user is required.');
  }
  const profile = await getCurrentUserAuthProfile(authInfo);
  const availableMethods = new Set((profile.authMethods || []).map((method) => method.type));
  if (!availableMethods.has(String(input.preferredAuthMethod || '').trim())) {
    throw new Error('The selected authentication method is not available for this account.');
  }
  return setUserPreferredAuthMethod({
    userId: user.id,
    preferredAuthMethod: input.preferredAuthMethod
  });
}

export async function getCurrentUserAuthProfile(authInfo = null) {
  const user = await findCurrentUserFromAuthInfo(authInfo);
  if (!user) {
    return { user: null, authMethods: [] };
  }
  const allowedMethods = await getAllowedAuthMethods();
  const store = getUserPersistoStore();
  const rawUser = await store.selectOne('user', { id: user.id });
  const authMethods = [];
  if (allowedMethods.includes('emailCode')) {
    authMethods.push({ type: 'emailCode', name: 'Email authentication code' });
  }
  if (allowedMethods.includes('password') && rawUser?.passwordHash) {
    authMethods.push({ type: 'password', name: 'Username and password' });
  }
  if (allowedMethods.includes('passkey')) {
    const credentials = await store.select('passkeyCredential', { userId: user.id }, { limit: 20 }).catch(() => []);
    for (const credential of credentials) {
      authMethods.push({
        type: 'passkey',
        id: credential.credentialId || credential.id,
        name: credential.name || 'Passkey'
      });
    }
  }
  if (allowedMethods.includes('totp')) {
    const totp = await store.selectOne('totpSecret', { userId: user.id }).catch(() => null);
    if (totp?.enabledAt) {
      authMethods.push({ type: 'totp', name: 'TOTP verification' });
    }
  }
  const passkeyCredentials = await store.select('passkeyCredential', { userId: user.id }, { limit: 20 }).catch(() => []);
  const totpSecret = await store.selectOne('totpSecret', { userId: user.id }).catch(() => null);
  return {
    user,
    authMethods,
    allowedAuthMethods: allowedMethods,
    enrollments: {
      passkey: {
        allowed: allowedMethods.includes('passkey'),
        configured: passkeyCredentials.length > 0,
        count: passkeyCredentials.length
      },
      totp: {
        allowed: allowedMethods.includes('totp'),
        configured: Boolean(totpSecret?.enabledAt),
        pending: Boolean(totpSecret && !totpSecret.enabledAt)
      }
    }
  };
}

export async function authenticateUserPassword(input = {}) {
  const username = normalizeUsername(input.username);
  const password = String(input.password || '');
  const requireExplorerAccess = input.requireExplorerAccess !== false;
  if (!password) throw new Error('Password is required.');
  const user = await getUserPersistoStore().findOne('user', (row) => String(row.username || '') === username);
  if (!user || String(user.status || 'active') !== 'active') {
    throw new Error('Invalid username or password.');
  }
  if (!verifyPasswordHash(password, user.passwordHash)) {
    throw new Error('Invalid username or password.');
  }
  if (requireExplorerAccess && !roleCanAccessExplorer(user.role)) {
    throw new Error('This user does not have Explorer access.');
  }
  return publicUser(user);
}

export async function findUserByEmail(email) {
  const value = normalizeEmail(email);
  return publicUser(await getUserPersistoStore().findOne('user', (user) => String(user.email || '').toLowerCase() === value));
}

export async function findUserById(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  return publicUser(await getUserPersistoStore().findOne('user', (user) => String(user.id || '') === id));
}
