import crypto from 'node:crypto';
import { getUserPersistoStore } from '../storage/persisto-store.mjs';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(secret) {
  const clean = String(secret || '').replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return String(code).padStart(6, '0');
}

function currentCounter(stepSeconds = 30) {
  return Math.floor(Date.now() / 1000 / stepSeconds);
}

function verifyCode(secret, code, window = 1) {
  const expectedCode = String(code || '').trim();
  if (!/^\d{6}$/.test(expectedCode)) return false;
  const counter = currentCounter();
  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, counter + offset) === expectedCode) return true;
  }
  return false;
}

function requiredSecret() {
  const secret = String(process.env.USERPERSISTO_SETTINGS_SECRET || '').trim();
  if (!secret) {
    throw new Error('USERPERSISTO_SETTINGS_SECRET is required for TOTP secrets.');
  }
  return secret;
}

function keyBytes() {
  return crypto.createHash('sha256')
    .update(requiredSecret())
    .digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  const text = String(value || '');
  const parts = text.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return text;
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export async function setupTotp(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const store = getUserPersistoStore();
  const secret = base32Encode(crypto.randomBytes(20));
  const existing = await store.selectOne('totpSecret', { userId });
  const payload = {
    userId,
    secretEncrypted: encryptSecret(secret),
    enabledAt: ''
  };
  const record = existing
    ? await store.update('totpSecret', existing.id, payload)
    : await store.create('totpSecret', payload);
  await store.appendAudit('auth.totp.setup', { targetType: 'user', targetId: userId });
  const issuer = encodeURIComponent(input.issuer || 'Ploinky');
  const label = encodeURIComponent(input.label || userId);
  return {
    ok: true,
    userId,
    secret,
    otpauthUrl: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}`,
    enabled: Boolean(record.enabledAt)
  };
}

export async function verifyTotp(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const record = await getUserPersistoStore().selectOne('totpSecret', { userId });
  if (!record?.secretEncrypted) throw new Error('TOTP is not configured for this user.');
  const valid = verifyCode(decryptSecret(record.secretEncrypted), input.code);
  if (!valid) throw new Error('Invalid TOTP code.');
  if (!record.enabledAt) {
    await getUserPersistoStore().update('totpSecret', record.id, { enabledAt: new Date().toISOString() });
  }
  await getUserPersistoStore().appendAudit('auth.totp.verify', { targetType: 'user', targetId: userId });
  return { ok: true, userId, verified: true };
}
