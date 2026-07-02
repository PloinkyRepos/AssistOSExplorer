import { randomUUID } from 'node:crypto';
import { getStore, flush } from './store.mjs';
import { getUserById, getUserRoles } from './users.mjs';
import { getUserCapabilities } from './authorization.mjs';
import { recordAudit } from './audit.mjs';

const REQUEST_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;

export async function createLoginRequest({ redirectUri, clientId = 'explorer' }) {
    if (!/^https?:\/\//.test(String(redirectUri || ''))) {
        throw new Error('redirectUri must be an absolute http(s) URL');
    }
    const store = await getStore();
    const providerState = randomUUID();
    const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();
    await store.createSsoLoginRequest({
        providerState,
        redirectUri: String(redirectUri),
        clientId: String(clientId || 'explorer'),
        expiresAt
    });
    await flush();
    return { providerState, expiresAt };
}

export async function issueAuthCode({ providerState, userId }) {
    const store = await getStore();
    if (!(await store.hasSsoLoginRequest(providerState))) {
        throw new Error('Unknown or expired login request');
    }
    const request = await store.getSsoLoginRequestByProviderState(providerState);
    if (new Date(request.expiresAt).getTime() < Date.now()) {
        throw new Error('Login request expired');
    }
    const code = randomUUID();
    await store.createSsoAuthCode({
        code,
        providerState,
        userId,
        expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        consumedAt: ''
    });
    await flush();
    return { code, redirectUri: request.redirectUri };
}

async function describeUser(userId) {
    const user = await getUserById(userId);
    if (!user) {
        throw new Error('Unknown user');
    }
    if (user.status !== 'active') {
        throw new Error('User is not active');
    }
    const roles = await getUserRoles(userId);
    const capabilities = await getUserCapabilities(userId);
    const { passwordHash, loginAttempts, lastLoginAttempt, ...safeUser } = user;
    return { user: safeUser, roles, capabilities };
}

export async function consumeAuthCode({ providerState, code }) {
    const store = await getStore();
    const normalizedCode = String(code || '');
    if (!(await store.hasSsoAuthCode(normalizedCode))) {
        throw new Error('Invalid auth code');
    }
    const record = await store.getSsoAuthCodeByCode(normalizedCode);
    if (record.providerState !== providerState) {
        throw new Error('Invalid auth code');
    }
    if (record.consumedAt) {
        throw new Error('Auth code already consumed');
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
        throw new Error('Auth code expired');
    }
    await store.updateSsoAuthCode(record.id, { consumedAt: new Date().toISOString() });
    const described = await describeUser(record.userId);
    await recordAudit({ actorId: record.userId, action: 'auth.sso.consume', target: providerState, result: 'ok' });
    await flush();
    return described;
}

export async function getSsoUser(userId) {
    return describeUser(userId);
}
