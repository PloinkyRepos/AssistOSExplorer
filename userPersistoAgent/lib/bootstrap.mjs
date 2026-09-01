import { getStore, flush } from './store.mjs';
import { createUser } from './users.mjs';
import { recordAudit } from './audit.mjs';

const ROLES = [
    { name: 'admin', description: 'Full administration', priority: 1 },
    { name: 'user', description: 'Explorer user', priority: 2 },
    { name: 'selfRegistered', description: 'Self-registered dashboard user', priority: 3 }
];

const CAPABILITIES = [
    { capability: 'explorer.access', description: 'Access the Explorer workspace', scope: 'product', roles: ['admin', 'user'] },
    { capability: 'admin.users.manage', description: 'Manage users and roles', scope: 'admin', roles: ['admin'] },
    { capability: 'admin.agentSettings.manage', description: 'Manage agent settings', scope: 'admin', roles: ['admin'] },
    { capability: 'admin.billing.manage', description: 'Manage billing', scope: 'admin', roles: ['admin'] },
    { capability: 'selfregistered.dashboard.access', description: 'Access the self-registered dashboard', scope: 'product', roles: ['selfRegistered'] }
];

export async function ensureSeedData() {
    const store = await getStore();
    for (const role of ROLES) {
        if (!(await store.hasRole(role.name))) {
            await store.createRole(role);
        }
    }
    for (const { roles, ...perm } of CAPABILITIES) {
        if (!(await store.hasPermission(perm.capability))) {
            await store.createPermission(perm);
        }
        const permission = await store.getPermissionByCapability(perm.capability);
        for (const roleName of roles) {
            const role = await store.getRoleByName(roleName);
            const key = `${role.id}:${permission.id}`;
            if (!(await store.hasRolePermission(key))) {
                await store.createRolePermission({ key, roleId: role.id, permissionId: permission.id });
            }
        }
    }
    await flush();
}

export async function ensureDevAdmin() {
    if (process.env.USERPERSISTO_DEV_BOOTSTRAP !== 'true') {
        return;
    }
    const password = String(process.env.USERPERSISTO_DEV_PASSWORD || '');
    if (!password) {
        console.warn('[userPersisto] USERPERSISTO_DEV_BOOTSTRAP was ignored because USERPERSISTO_DEV_PASSWORD is not configured.');
        return;
    }
    const store = await getStore();
    const anyUsers = await store.select('user', {}, { pageSize: 1 });
    if (anyUsers.totalCount > 0) {
        return;
    }
    await createUser({ email: 'admin@dev.local', displayName: 'Dev Admin', source: 'dev-bootstrap', roles: ['admin'], password });
    await recordAudit({ actorId: 'system', action: 'dev.bootstrap.admin', target: 'admin@dev.local', reason: 'USERPERSISTO_DEV_BOOTSTRAP=true and user table was empty' });
    console.warn('[userPersisto] DEV BOOTSTRAP: created admin@dev.local with the explicitly configured development password.');
}
