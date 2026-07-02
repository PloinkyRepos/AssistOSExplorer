import { findUserByEmail, findUserById } from './users.mjs';
import { getCreditBalance } from './credits/ledger.mjs';
import { userCanAccessClient } from './auth-clients.mjs';
import { getUserPersistoStore } from './storage/persisto-store.mjs';

function normalizeCapability(value) {
  const capability = String(value || '').trim();
  if (!capability) throw new Error('capability is required.');
  if (!/^[a-zA-Z0-9._:-]+$/.test(capability)) {
    throw new Error('capability contains unsupported characters.');
  }
  return capability;
}

function capabilityMatches(grant, requested) {
  if (grant === requested) return true;
  if (grant.endsWith('.*')) {
    return requested.startsWith(grant.slice(0, -1));
  }
  return false;
}

async function getPersistedCapabilities(user) {
  const store = getUserPersistoStore();
  const userRoles = await store.select('userRole', { userId: user.id }, { limit: 100 }).catch(() => []);
  const roleIds = new Set(userRoles.map((record) => String(record.roleId || '').trim()).filter(Boolean));
  if (user.role) roleIds.add(String(user.role).trim());
  const capabilities = new Set();
  for (const roleId of roleIds) {
    const rolePermissions = await store.select('rolePermission', { roleId }, { limit: 1000 }).catch(() => []);
    for (const rolePermission of rolePermissions) {
      const permissionId = String(rolePermission.permissionId || '').trim();
      if (!permissionId) continue;
      const permission = await store.selectOne('permission', { id: permissionId }).catch(() => null)
        || await store.selectOne('permission', { capability: permissionId }).catch(() => null);
      if (permission?.capability) capabilities.add(String(permission.capability).trim());
    }
  }
  return capabilities;
}

export async function getUserCapabilities(user) {
  if (!user) return [];
  const capabilities = new Set(await getPersistedCapabilities(user));
  return [...capabilities].filter(Boolean).sort();
}

export async function authorizeCapability(input = {}) {
  const user = input.userId
    ? await findUserById(input.userId)
    : input.email
      ? await findUserByEmail(input.email)
      : null;
  const capability = normalizeCapability(input.capability);
  if (!user) {
    return { allowed: false, reason: 'user_not_found', user: null, capability, capabilities: [] };
  }
  if (user.status && user.status !== 'active') {
    return { allowed: false, reason: 'user_inactive', user, capability, capabilities: [] };
  }
  const capabilities = await getUserCapabilities(user);
  const allowed = capabilities.some((grant) => capabilityMatches(grant, capability));
  if (!allowed) {
    return { allowed: false, reason: 'capability_denied', user, capability, capabilities };
  }
  const creditCost = Number(input.creditCost || 0);
  if (creditCost > 0) {
    const balance = await getCreditBalance({ userId: user.id });
    if (balance.available < creditCost) {
      return {
        allowed: false,
        reason: 'insufficient_credits',
        user,
        capability,
        capabilities,
        balance: balance.balance,
        reserved: balance.reserved,
        available: balance.available
      };
    }
  }
  return { allowed: true, reason: 'allowed', user, capability, capabilities };
}

export async function checkAccess(input = {}) {
  const user = input.userId
    ? await findUserById(input.userId)
    : input.email
      ? await findUserByEmail(input.email)
      : null;
  if (!user) {
    return { allowed: false, reason: 'user_not_found', user: null };
  }
  if (user.status && user.status !== 'active') {
    return { allowed: false, reason: 'user_inactive', user };
  }
  if (input.capability) {
    return authorizeCapability({ ...input, userId: user.id });
  }
  const clientId = String(input.clientId || '').trim();
  if (!clientId) {
    return { allowed: false, reason: 'client_required', user };
  }
  if (!userCanAccessClient(user, clientId)) {
    return { allowed: false, reason: 'role_denied', user };
  }
  const creditCost = Number(input.creditCost || 0);
  if (creditCost > 0) {
    const balance = await getCreditBalance({ userId: user.id });
    if (balance.available < creditCost) {
      return {
        allowed: false,
        reason: 'insufficient_credits',
        user,
        balance: balance.balance,
        reserved: balance.reserved,
        available: balance.available
      };
    }
  }
  return { allowed: true, reason: 'allowed', user };
}
