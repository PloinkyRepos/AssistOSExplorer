import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore, flush } from '../store.mjs';
import { getUserByEmail, getUserById } from '../users.mjs';
import { recordAudit } from '../audit.mjs';

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;
const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 5 * 60 * 1000;

export function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 4) {
        throw new Error('Password too short');
    }
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
    if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) {
        return false;
    }
    const [, n, rr, pp, saltB64, hashB64] = stored.split('$');
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = scryptSync(String(password ?? ''), salt, expected.length, { N: Number(n), r: Number(rr), p: Number(pp) });
    return timingSafeEqual(actual, expected);
}

function isLocked(user) {
    if ((user.loginAttempts || 0) < MAX_ATTEMPTS) {
        return false;
    }
    const last = user.lastLoginAttempt ? new Date(user.lastLoginAttempt).getTime() : 0;
    return Date.now() - last < LOCK_WINDOW_MS;
}

export async function loginWithPassword(email, password) {
    const store = await getStore();
    const user = await getUserByEmail(email);
    if (!user) {
        return { ok: false, reason: 'invalid_credentials' };
    }
    if (user.status !== 'active') {
        return { ok: false, reason: 'user_blocked' };
    }
    if (isLocked(user)) {
        return { ok: false, reason: 'account_locked' };
    }
    if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        await store.updateUser(user.id, {
            loginAttempts: (user.loginAttempts || 0) + 1,
            lastLoginAttempt: new Date().toISOString()
        });
        await recordAudit({ actorId: user.id, action: 'auth.password.login', target: user.id, result: 'denied', reason: 'invalid_credentials' });
        await flush();
        return { ok: false, reason: 'invalid_credentials' };
    }
    const fresh = await store.updateUser(user.id, { loginAttempts: 0, lastLoginAttempt: '' });
    await recordAudit({ actorId: user.id, action: 'auth.password.login', target: user.id, result: 'ok' });
    await flush();
    return { ok: true, user: fresh };
}

export async function setPassword({ userId, newPassword, actorId }) {
    const store = await getStore();
    const user = await getUserById(userId);
    if (!user) {
        throw new Error(`Unknown user: ${userId}`);
    }
    await store.updateUser(user.id, {
        passwordHash: hashPassword(newPassword),
        loginAttempts: 0,
        lastLoginAttempt: ''
    });
    await recordAudit({ actorId: actorId || userId, action: 'auth.password.set', target: userId, result: 'ok' });
    await flush();
}
