export const USERPERSISTO_ROLES = Object.freeze(['admin', 'user', 'selfRegistered']);

export function assertRole(value) {
  const role = String(value || '').trim();
  if (!USERPERSISTO_ROLES.includes(role)) {
    throw new Error(`Invalid role "${role}". Allowed roles: ${USERPERSISTO_ROLES.join(', ')}.`);
  }
  return role;
}

export function roleCanAccessExplorer(role) {
  return role === 'admin' || role === 'user';
}

export function roleCanAdminister(role) {
  return role === 'admin';
}
