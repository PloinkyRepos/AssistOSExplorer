import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password ?? ''), salt, 64);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPasswordHash(password, passwordHash) {
  const parts = String(passwordHash || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(String(password ?? ''), salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
