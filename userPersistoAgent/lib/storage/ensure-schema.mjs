import { getUserPersistoStore } from './persisto-store.mjs';

const TYPES = {
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
  subscription: {
    id: 'string',
    userId: 'string',
    provider: 'string',
    providerCustomerId: 'string',
    providerSubscriptionId: 'string',
    status: 'string',
    currentPeriodEnd: 'string'
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

let ensured = false;

export async function ensureUserPersistoSchema() {
  if (ensured) return { ok: true, skipped: true };
  const store = getUserPersistoStore();
  const configured = await store.configureTypes(TYPES).catch(() => false);
  ensured = true;
  return {
    ok: true,
    storageAvailable: Boolean(configured),
    types: Object.keys(TYPES)
  };
}

export { TYPES as USERPERSISTO_TYPES };
