import { getStore } from './store.mjs';
import { getUserById, getUserRoles } from './users.mjs';

export async function getUserCapabilities(userId) {
    const store = await getStore();
    const roleNames = await getUserRoles(userId);
    const caps = new Set();
    for (const name of roleNames) {
        const role = await store.getRoleByName(name);
        if (!role) {
            continue;
        }
        const links = await store.getRolePermsObjectsByRoleId(role.id) || [];
        for (const link of links) {
            const perm = await store.getPermission(link.permissionId);
            if (perm) {
                caps.add(perm.capability);
            }
        }
    }
    return [...caps].sort();
}

export async function authorizeCapability({ userId, capability, resource = '' }) {
    const user = await getUserById(userId);
    if (!user) {
        return { allowed: false, reason: 'unknown_user' };
    }
    if (user.status !== 'active') {
        return { allowed: false, reason: `user_${user.status}` };
    }
    const caps = await getUserCapabilities(userId);
    if (!caps.includes(String(capability))) {
        return { allowed: false, reason: 'capability_not_granted' };
    }
    return { allowed: true, reason: resource ? `capability_granted:${resource}` : 'capability_granted' };
}

export async function getProfile(userId) {
    const store = await getStore();
    const user = await getUserById(userId);
    if (!user) {
        throw new Error(`Unknown user: ${userId}`);
    }
    const roles = await getUserRoles(userId);
    const capabilities = await getUserCapabilities(userId);
    const account = await store.getCreditAccountByUserId(userId) || null;
    const subs = await store.getSubscriptionsObjectsByUserId(userId) || [];
    const active = subs.find((subscription) => subscription.status === 'active') || null;
    const { passwordHash, loginAttempts, lastLoginAttempt, ...safeUser } = user;
    return {
        user: safeUser,
        roles,
        capabilities,
        credits: { balance: account?.balance ?? 0, reservedBalance: account?.reservedBalance ?? 0 },
        subscription: active
    };
}
