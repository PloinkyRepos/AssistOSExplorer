import crypto from 'node:crypto';
import { getUserPersistoStore } from '../storage/persisto-store.mjs';
import { createUser, findUserByEmail } from '../users.mjs';
import { sendAuthCodeEmail } from '../email-agent-client.mjs';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function requiredSecret() {
  const secret = String(process.env.USERPERSISTO_SETTINGS_SECRET || '').trim();
  if (!secret) {
    throw new Error('USERPERSISTO_SETTINGS_SECRET is required for email authentication codes.');
  }
  return secret;
}

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error('A valid email is required.');
  }
  return value;
}

function hashCode(email, code) {
  return crypto
    .createHash('sha256')
    .update(`${email}:${code}:${requiredSecret()}`)
    .digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function pickCurrentEmailCode(records = []) {
  return [...records].sort((a, b) => {
    const left = String(a.updatedAt || a.createdAt || '');
    const right = String(b.updatedAt || b.createdAt || '');
    return right.localeCompare(left);
  })[0] || null;
}

export async function startEmailCodeLogin(input = {}) {
  const store = getUserPersistoStore();
  const email = normalizeEmail(input.email);
  let user = await findUserByEmail(email).catch(() => null);
  let userCreated = false;
  if (!user && input.createSelfRegisteredUser === true) {
    user = await createUser({ email, role: 'selfRegistered', status: 'active' });
    userCreated = true;
  }
  if (!user) {
    throw new Error('No active account is available for this email.');
  }
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const payload = {
    email,
    codeHash: hashCode(email, code),
    expiresAt,
    consumedAt: '',
    attempts: 0,
    lastAttempt: '',
    verifiedAt: ''
  };
  const current = pickCurrentEmailCode(await store.select('emailAuthCode', { email }, { limit: 100 }));
  if (current?.id) {
    await store.update('emailAuthCode', current.id, payload);
  } else {
    await store.create('emailAuthCode', payload);
  }
  await store.appendAudit('auth.email_code.start', {
    actorUserId: user.id,
    targetType: 'user',
    targetId: user.id,
    metadata: { email, expiresAt, userCreated }
  });
  const delivery = await sendAuthCodeEmail({ email, code, expiresAt });
  return {
    ok: true,
    email,
    userCreated,
    expiresAt,
    delivery,
  };
}

export async function verifyEmailCode(input = {}) {
  const store = getUserPersistoStore();
  const email = normalizeEmail(input.email);
  const code = String(input.code || '').trim();
  if (!code) throw new Error('code is required.');
  const active = pickCurrentEmailCode(await store.select('emailAuthCode', { email }, { limit: 100 }));
  if (!active) throw new Error('No active email code found.');
  if (new Date(active.expiresAt).getTime() < Date.now()) {
    throw new Error('Email code expired.');
  }
  if (Number(active.attempts || 0) >= MAX_ATTEMPTS) {
    throw new Error('Too many email code attempts.');
  }
  const nextAttempts = Number(active.attempts || 0) + 1;
  if (active.codeHash !== hashCode(email, code)) {
    await store.update('emailAuthCode', active.id, {
      attempts: nextAttempts,
      lastAttempt: new Date().toISOString()
    });
    throw new Error('Invalid email code.');
  }
  await store.update('emailAuthCode', active.id, {
    attempts: 0,
    lastAttempt: '',
    verifiedAt: new Date().toISOString()
  });
  const user = await findUserByEmail(email).catch(() => null);
  if (!user) throw new Error('No active account is available for this email.');
  const session = await store.create('session', {
    userId: user.id,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: ''
  });
  await store.appendAudit('auth.email_code.verify', { actorUserId: user.id, targetType: 'user', targetId: user.id });
  return { ok: true, user, session };
}
