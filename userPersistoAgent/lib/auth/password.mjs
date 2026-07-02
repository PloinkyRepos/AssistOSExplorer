import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

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
