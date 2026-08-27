export function isAdminUser(user) {
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
        return false;
    }
    const roles = Array.isArray(user.roles)
        ? user.roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
        : [];
    const username = String(user.username || '').trim().toLowerCase();
    const id = String(user.id || user.userId || '').trim().toLowerCase();
    return roles.includes('admin') || username === 'admin' || id === 'local:admin';
}

export default isAdminUser;
