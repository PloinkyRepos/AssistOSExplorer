export const USERPERSISTO_AUTH_CLIENT_IDS = Object.freeze({
  EXPLORER: 'explorer',
  SELF_REGISTERED_APP: 'selfRegisteredApp'
});

const AUTH_CLIENTS = Object.freeze({
  [USERPERSISTO_AUTH_CLIENT_IDS.EXPLORER]: {
    id: USERPERSISTO_AUTH_CLIENT_IDS.EXPLORER,
    roles: ['admin', 'user'],
    defaultReturnTo: '/explorer/index.html'
  },
  [USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP]: {
    id: USERPERSISTO_AUTH_CLIENT_IDS.SELF_REGISTERED_APP,
    roles: ['selfRegistered', 'admin', 'user'],
    defaultReturnTo: '/selfregistered/'
  }
});

export function normalizeAuthClientId(value) {
  const clientId = String(value || '').trim();
  if (!clientId) {
    throw new Error('UserPersisto clientId is required.');
  }
  if (!AUTH_CLIENTS[clientId]) {
    throw new Error(`Unknown UserPersisto clientId: ${clientId}.`);
  }
  return clientId;
}

export function getAuthClient(clientId) {
  return AUTH_CLIENTS[normalizeAuthClientId(clientId)];
}

export function userCanAccessClient(user, clientId) {
  if (!user || String(user.status || 'active') !== 'active') return false;
  const client = getAuthClient(clientId);
  return client.roles.includes(String(user.role || '').trim());
}

export function assertUserCanAccessClient(user, clientId) {
  if (!userCanAccessClient(user, clientId)) {
    throw new Error(`User is not allowed to access ${getAuthClient(clientId).id}.`);
  }
}
