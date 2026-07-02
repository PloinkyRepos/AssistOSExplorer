const ensuredStores = new WeakSet();

// Field lists are documentation; Persisto does NOT enforce them. Validation lives in the domain modules.
export const TYPES = {
    user: { email: 'string', displayName: 'string', status: 'string', source: 'string', createdAt: 'string', passwordHash: 'string', loginAttempts: 'integer', lastLoginAttempt: 'string' },
    role: { name: 'string', description: 'string', priority: 'integer' },
    permission: { capability: 'string', description: 'string', scope: 'string' },
    userRole: { key: 'string', userId: 'string', roleId: 'string' },
    rolePermission: { key: 'string', roleId: 'string', permissionId: 'string' },
    authMethod: { key: 'string', userId: 'string', type: 'string', credential: 'object', enabled: 'boolean' },
    authChallenge: { challengeId: 'string', subject: 'string', purpose: 'string', codeHash: 'string', expiresAt: 'string', attempts: 'integer', correlationId: 'string' },
    creditAccount: { userId: 'string', balance: 'integer', reservedBalance: 'integer' },
    creditTx: { txId: 'string', userId: 'string', type: 'string', amount: 'integer', reason: 'string', referenceId: 'string', createdAt: 'string' },
    subscription: { providerRef: 'string', userId: 'string', provider: 'string', planId: 'string', status: 'string', currentPeriodEnd: 'string' },
    billingEvent: { stripeEventId: 'string', type: 'string', status: 'string', payloadHash: 'string', processedAt: 'string' },
    emailLog: { logId: 'string', providerMessageId: 'string', toEmailHash: 'string', template: 'string', result: 'string', correlationId: 'string', createdAt: 'string' },
    auditEvent: { auditId: 'string', actorId: 'string', action: 'string', target: 'string', result: 'string', reason: 'string', timestamp: 'string' },
    ssoLoginRequest: { providerState: 'string', redirectUri: 'string', clientId: 'string', expiresAt: 'string' },
    ssoAuthCode: { code: 'string', providerState: 'string', userId: 'string', expiresAt: 'string', consumedAt: 'string' }
};

const INDEXES = [
    ['user', 'email'],
    ['role', 'name'],
    ['permission', 'capability'],
    ['userRole', 'key'],
    ['rolePermission', 'key'],
    ['authMethod', 'key'],
    ['authChallenge', 'challengeId'],
    ['creditAccount', 'userId'],
    ['creditTx', 'txId'],
    ['subscription', 'providerRef'],
    ['billingEvent', 'stripeEventId'],
    ['emailLog', 'logId'],
    ['auditEvent', 'auditId'],
    ['ssoLoginRequest', 'providerState'],
    ['ssoAuthCode', 'code']
];

// [groupingName, type, field] -> get<Grouping>ObjectsBy<Field>()
const GROUPINGS = [
    ['userRoles', 'userRole', 'userId'],
    ['rolePerms', 'rolePermission', 'roleId'],
    ['authMethods', 'authMethod', 'userId'],
    ['creditHistory', 'creditTx', 'userId'],
    ['subscriptions', 'subscription', 'userId'],
    ['auditTrail', 'auditEvent', 'actorId']
];

export async function ensureSchema(persisto) {
    if (ensuredStores.has(persisto)) {
        return persisto;
    }
    persisto.configureTypes(TYPES);
    for (const [type, field] of INDEXES) {
        await persisto.createIndex(type, field);
    }
    for (const [name, type, field] of GROUPINGS) {
        await persisto.createGrouping(name, type, field);
    }
    ensuredStores.add(persisto);
    return persisto;
}
