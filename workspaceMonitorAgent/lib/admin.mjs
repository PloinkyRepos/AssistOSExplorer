function normalizedRoles(actor) {
    return Array.isArray(actor?.roles) ? actor.roles.map((role) => String(role || '').trim().toLowerCase()) : [];
}

export function assertAdministrator(actor) {
    const user = actor?.user && typeof actor.user === 'object' ? actor.user : actor;
    const username = String(user?.username || '').trim().toLowerCase();
    const userId = String(user?.id || '').trim().toLowerCase();
    const principalId = String(actor?.principalId || '').trim().toLowerCase();
    if (normalizedRoles(user).includes('admin') || username === 'admin' || userId === 'local:admin' || principalId === 'user:local:admin') {
        return;
    }
    throw new Error('Access denied: Workspace Monitor requires an administrator.');
}
