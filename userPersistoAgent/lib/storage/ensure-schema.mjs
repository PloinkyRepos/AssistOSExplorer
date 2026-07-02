import { getUserPersistoStore } from './persisto-store.mjs';

const TYPES = {
  role: {
    id: 'string',
    name: 'string',
    description: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  permission: {
    id: 'string',
    capability: 'string',
    description: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  userRole: {
    id: 'string',
    userId: 'string',
    roleId: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  rolePermission: {
    id: 'string',
    naturalKey: 'string',
    roleId: 'string',
    permissionId: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  user: {
    id: 'string',
    email: 'string',
    username: 'string',
    passwordHash: 'string',
    rev: 'number',
    displayName: 'string',
    preferredAuthMethod: 'string',
    role: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  session: {
    id: 'string',
    userId: 'string',
    createdAt: 'string',
    expiresAt: 'string',
    revokedAt: 'string'
  },
  ssoLoginRequest: {
    id: 'string',
    providerState: 'string',
    clientId: 'string',
    redirectUri: 'string',
    expiresAt: 'string',
    consumedAt: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  ssoAuthCode: {
    id: 'string',
    providerState: 'string',
    clientId: 'string',
    codeHash: 'string',
    userId: 'string',
    expiresAt: 'string',
    consumedAt: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  emailAuthCode: {
    id: 'string',
    email: 'string',
    codeHash: 'string',
    expiresAt: 'string',
    consumedAt: 'string',
    attempts: 'number',
    lastAttempt: 'string',
    verifiedAt: 'string'
  },
  authMethod: {
    id: 'string',
    userId: 'string',
    type: 'string',
    label: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  webauthnChallenge: {
    id: 'string',
    userId: 'string',
    email: 'string',
    challenge: 'string',
    type: 'string',
    rpId: 'string',
    origin: 'string',
    expiresAt: 'string',
    consumedAt: 'string',
    createdAt: 'string'
  },
  passkeyCredential: {
    id: 'string',
    userId: 'string',
    credentialId: 'string',
    publicKey: 'string',
    alg: 'number',
    counter: 'number',
    createdAt: 'string'
  },
  totpSecret: {
    id: 'string',
    userId: 'string',
    secretEncrypted: 'string',
    enabledAt: 'string'
  },
  creditLedgerEntry: {
    id: 'string',
    userId: 'string',
    amount: 'number',
    reason: 'string',
    reference: 'string',
    createdAt: 'string'
  },
  creditAccount: {
    id: 'string',
    userId: 'string',
    currency: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  creditReservation: {
    id: 'string',
    userId: 'string',
    amount: 'number',
    reason: 'string',
    reference: 'string',
    status: 'string',
    createdAt: 'string',
    updatedAt: 'string',
    committedAt: 'string',
    releasedAt: 'string'
  },
  subscription: {
    id: 'string',
    userId: 'string',
    provider: 'string',
    providerCustomerId: 'string',
    providerSubscriptionId: 'string',
    status: 'string',
    currentPeriodEnd: 'string'
  },
  billingEvent: {
    id: 'string',
    provider: 'string',
    providerEventId: 'string',
    type: 'string',
    status: 'string',
    userId: 'string',
    metadata: 'object',
    receivedAt: 'string',
    processedAt: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  },
  emailDeliveryLog: {
    id: 'string',
    provider: 'string',
    email: 'string',
    template: 'string',
    status: 'string',
    providerMessageId: 'string',
    metadata: 'object',
    createdAt: 'string',
    updatedAt: 'string'
  },
  auditEvent: {
    id: 'string',
    actorUserId: 'string',
    action: 'string',
    targetType: 'string',
    targetId: 'string',
    metadata: 'object',
    createdAt: 'string'
  },
  agentSetting: {
    id: 'string',
    agentName: 'string',
    key: 'string',
    encryptedValue: 'string',
    updatedAt: 'string'
  }
};

const INDEXES = {
  role: 'name',
  permission: 'capability',
  userRole: 'id',
  rolePermission: 'naturalKey',
  user: 'email',
  session: 'id',
  ssoLoginRequest: 'providerState',
  ssoAuthCode: 'codeHash',
  emailAuthCode: 'id',
  webauthnChallenge: 'challenge',
  passkeyCredential: 'credentialId',
  totpSecret: 'userId',
  creditLedgerEntry: 'id',
  creditAccount: 'userId',
  creditReservation: 'id',
  subscription: 'userId',
  billingEvent: 'providerEventId',
  auditEvent: 'id'
};

let ensured = false;

const DEFAULT_ROLES = [
  { id: 'admin', name: 'admin', description: 'Workspace administrator' },
  { id: 'user', name: 'user', description: 'Workspace user' },
  { id: 'selfRegistered', name: 'selfRegistered', description: 'Self-registered application user' }
];

const DEFAULT_PERMISSIONS = [
  { id: 'explorer-access', capability: 'explorer.access', description: 'Access the Explorer workspace' },
  { id: 'selfregistered-access', capability: 'selfregistered.access', description: 'Access the self-registered app' }
];

const DEFAULT_ROLE_PERMISSIONS = [
  ...DEFAULT_PERMISSIONS.map((permission) => ({ roleId: 'admin', permissionId: permission.id })),
  { roleId: 'user', permissionId: 'explorer-access' },
  { roleId: 'user', permissionId: 'selfregistered-access' },
  { roleId: 'selfRegistered', permissionId: 'selfregistered-access' }
].map((rolePermission) => ({
  ...rolePermission,
  naturalKey: `${rolePermission.roleId}:${rolePermission.permissionId}`
}));

async function createIfMissing(store, table, uniqueFilter, payload) {
  const existing = await store.selectOne(table, uniqueFilter).catch(() => null);
  if (existing) return existing;
  try {
    return await store.create(table, payload);
  } catch (error) {
    if (table === 'rolePermission' && /Creation conflicts detected/i.test(String(error?.message || error || ''))) {
      return null;
    }
    throw error;
  }
}

async function seedDefaultAuthorizationModel(store) {
  for (const role of DEFAULT_ROLES) {
    await createIfMissing(store, 'role', { name: role.name }, role);
  }
  for (const permission of DEFAULT_PERMISSIONS) {
    await createIfMissing(store, 'permission', { capability: permission.capability }, permission);
  }
  for (const rolePermission of DEFAULT_ROLE_PERMISSIONS) {
    await createIfMissing(store, 'rolePermission', { naturalKey: rolePermission.naturalKey }, rolePermission);
  }
}

export async function ensureUserPersistoSchema() {
  if (ensured) return { ok: true, skipped: true };
  const store = getUserPersistoStore();
  const configured = await store.configureTypes(TYPES);
  await store.configureIndexes(INDEXES);
  await seedDefaultAuthorizationModel(store);
  ensured = true;
  return {
    ok: true,
    storageAvailable: Boolean(configured),
    types: Object.keys(TYPES),
    indexes: INDEXES
  };
}

export function resetUserPersistoSchemaForTests() {
  ensured = false;
}

export { TYPES as USERPERSISTO_TYPES, INDEXES as USERPERSISTO_INDEXES };
