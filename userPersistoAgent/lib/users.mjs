import { getStore, flush } from './store.mjs';
import { hashPassword } from './auth/password.mjs';
import { recordAudit } from './audit.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_STATUSES = new Set(['active', 'blocked']);

export async function getUserByEmail(email) {
    const store = await getStore();
    const key = String(email || '').trim().toLowerCase();
    if (!key) {
        return null;
    }
    return (await store.hasUser(key)) ? store.getUser(key) : null;
}

export async function getUserById(id) {
    const store = await getStore();
    return (await store.hasUser(id)) ? store.getUser(id) : null;
}

export async function createUser({ email, displayName = '', source = 'admin', roles = ['user'], password = '' }) {
    const store = await getStore();
    const normalized = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
        throw new Error(`Invalid email: ${email}`);
    }
    if (await getUserByEmail(normalized)) {
        throw new Error(`User already exists: ${normalized}`);
    }
    const user = await store.createUser({
        email: normalized,
        displayName: String(displayName || normalized),
        status: 'active',
        source: String(source),
        createdAt: new Date().toISOString(),
        passwordHash: password ? hashPassword(password) : '',
        loginAttempts: 0,
        lastLoginAttempt: ''
    });
    await setUserRoles(user.id, roles, { actorId: 'system', audit: false });
    await recordAudit({ actorId: 'system', action: 'user.create', target: user.id, reason: source });
    await flush();
    return user;
}

export async function updateUser(userId, patch = {}) {
    const store = await getStore();
    const user = await getUserById(userId);
    if (!user) {
        throw new Error(`Unknown user: ${userId}`);
    }
    const update = {};
    if (patch.displayName !== undefined) {
        update.displayName = String(patch.displayName);
    }
    if (patch.status !== undefined) {
        if (!USER_STATUSES.has(patch.status)) {
            throw new Error(`Invalid status: ${patch.status}`);
        }
        update.status = patch.status;
    }
    const next = await store.updateUser(user.id, update);
    await recordAudit({ actorId: 'system', action: 'user.update', target: user.id, reason: Object.keys(update).join(',') });
    await flush();
    return next;
}

export async function listUsers({ start = 0, pageSize = 50 } = {}) {
    const store = await getStore();
    const result = await store.select('user', {}, { sortBy: 'createdAt', start, pageSize });
    return { users: result.objects, totalCount: result.totalCount };
}

export async function getUserRoles(userId) {
    const store = await getStore();
    const links = await store.getUserRolesObjectsByUserId(userId) || [];
    const names = [];
    for (const link of links) {
        const role = await store.getRole(link.roleId);
        if (role) {
            names.push(role.name);
        }
    }
    return names.sort();
}

export async function setUserRoles(userId, roleNames, { actorId = 'system', audit = true } = {}) {
    const store = await getStore();
    const roles = [];
    for (const name of roleNames) {
        const role = await store.getRoleByName(name);
        if (!role) {
            throw new Error(`Unknown role: ${name}`);
        }
        roles.push(role);
    }

    const existing = await store.getUserRolesObjectsByUserId(userId) || [];
    for (const link of existing) {
        await store.deleteUserRole(link.key);
    }
    const applied = [];
    for (const role of roles) {
        await store.createUserRole({ key: `${userId}:${role.id}`, userId, roleId: role.id });
        applied.push(role.name);
    }
    if (audit) {
        await recordAudit({ actorId, action: 'user.roles.update', target: userId, reason: applied.join(',') });
    }
    await flush();
    return applied.sort();
}
