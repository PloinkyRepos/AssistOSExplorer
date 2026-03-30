export function parseAuthInfoHeader(headers = {}) {
  const raw = headers['x-ploinky-auth-info'] || headers['X-PLOINKY-AUTH-INFO'];
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

export function getAuthUserDisplayName(authInfo = null) {
  const user = authInfo && typeof authInfo === 'object' ? authInfo.user : null;
  if (!user || typeof user !== 'object') {
    return 'Explorer User';
  }
  return String(user.username || user.name || user.email || 'Explorer User');
}

export function getAuthUserId(authInfo = null) {
  const user = authInfo && typeof authInfo === 'object' ? authInfo.user : null;
  if (!user || typeof user !== 'object') {
    return '';
  }
  return String(user.id || user.username || user.email || '');
}

