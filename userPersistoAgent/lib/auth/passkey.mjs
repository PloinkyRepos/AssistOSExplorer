import crypto from 'node:crypto';
import { getUserPersistoStore } from '../storage/persisto-store.mjs';
import { findUserByEmail, findUserById } from '../users.mjs';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RP_NAME = 'Ploinky';

function base64urlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value) {
  const text = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  return Buffer.from(text + '='.repeat((4 - (text.length % 4)) % 4), 'base64');
}

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error('A valid email is required.');
  }
  return value;
}

function normalizeRpId(input = {}) {
  const rpId = String(input.rpId || '').trim();
  if (rpId) return rpId;
  const origin = String(input.origin || '').trim();
  if (origin) return new URL(origin).hostname;
  return 'localhost';
}

function isIpAddress(value) {
  const host = String(value || '').trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
}

function publicRpId(rpId) {
  return isIpAddress(rpId) ? '' : rpId;
}

function normalizeOrigin(input = {}) {
  const origin = String(input.origin || '').trim();
  if (!origin) return '';
  const url = new URL(origin);
  return url.origin;
}

function requireClientData(response = {}, expectedType, challenge, origin) {
  const clientDataBuffer = base64urlDecode(response.clientDataJSON);
  const clientData = JSON.parse(clientDataBuffer.toString('utf8'));
  if (clientData.type !== expectedType) {
    throw new Error(`Invalid WebAuthn response type: ${clientData.type || 'missing'}.`);
  }
  if (challenge !== undefined && clientData.challenge !== challenge) {
    throw new Error('Invalid WebAuthn challenge.');
  }
  if (origin && clientData.origin !== origin) {
    throw new Error('Invalid WebAuthn origin.');
  }
  return { clientData, clientDataBuffer };
}

function readUInt(buffer, offset, length) {
  let value = 0;
  for (let i = 0; i < length; i += 1) value = (value << 8) | buffer[offset + i];
  return value;
}

class CborReader {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer);
    this.offset = 0;
  }

  readByte() {
    if (this.offset >= this.buffer.length) throw new Error('Unexpected end of CBOR data.');
    return this.buffer[this.offset++];
  }

  readLength(additional) {
    if (additional < 24) return additional;
    if (additional === 24) return this.readByte();
    if (additional === 25) {
      const value = readUInt(this.buffer, this.offset, 2);
      this.offset += 2;
      return value;
    }
    if (additional === 26) {
      const value = readUInt(this.buffer, this.offset, 4);
      this.offset += 4;
      return value;
    }
    throw new Error('Unsupported CBOR length.');
  }

  read() {
    const initial = this.readByte();
    const major = initial >> 5;
    const additional = initial & 0x1f;
    if (major === 0) return this.readLength(additional);
    if (major === 1) return -1 - this.readLength(additional);
    if (major === 2) {
      const length = this.readLength(additional);
      const value = this.buffer.subarray(this.offset, this.offset + length);
      this.offset += length;
      return Buffer.from(value);
    }
    if (major === 3) {
      const length = this.readLength(additional);
      const value = this.buffer.subarray(this.offset, this.offset + length).toString('utf8');
      this.offset += length;
      return value;
    }
    if (major === 4) {
      const length = this.readLength(additional);
      const value = [];
      for (let i = 0; i < length; i += 1) value.push(this.read());
      return value;
    }
    if (major === 5) {
      const length = this.readLength(additional);
      const value = new Map();
      for (let i = 0; i < length; i += 1) value.set(this.read(), this.read());
      return value;
    }
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
    }
    throw new Error('Unsupported CBOR item.');
  }
}

function decodeCbor(buffer) {
  return new CborReader(buffer).read();
}

function mapGet(map, key) {
  if (!(map instanceof Map)) return undefined;
  return map.get(key);
}

function parseAuthenticatorData(authData) {
  const buffer = Buffer.from(authData);
  if (buffer.length < 37) throw new Error('Invalid authenticator data.');
  const rpIdHash = buffer.subarray(0, 32);
  const flags = buffer[32];
  const counter = buffer.readUInt32BE(33);
  let offset = 37;
  let credential = null;
  if (flags & 0x40) {
    const aaguid = buffer.subarray(offset, offset + 16);
    offset += 16;
    const credentialIdLength = buffer.readUInt16BE(offset);
    offset += 2;
    const credentialId = buffer.subarray(offset, offset + credentialIdLength);
    offset += credentialIdLength;
    const cosePublicKey = buffer.subarray(offset);
    credential = { aaguid, credentialId, cosePublicKey };
  }
  return { rpIdHash, flags, counter, credential };
}

function assertRpIdHash(authData, rpId) {
  const expected = crypto.createHash('sha256').update(rpId).digest();
  if (!crypto.timingSafeEqual(authData.rpIdHash, expected)) {
    throw new Error('Invalid WebAuthn relying party id.');
  }
}

function coseToJwk(cosePublicKey) {
  const map = decodeCbor(cosePublicKey);
  const kty = mapGet(map, 1);
  const alg = mapGet(map, 3);
  if (kty === 2 && alg === -7) {
    const crv = mapGet(map, -1);
    const x = mapGet(map, -2);
    const y = mapGet(map, -3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
      throw new Error('Unsupported EC WebAuthn public key.');
    }
    return {
      alg,
      jwk: {
        kty: 'EC',
        crv: 'P-256',
        x: base64urlEncode(x),
        y: base64urlEncode(y)
      }
    };
  }
  if (kty === 3 && alg === -257) {
    const n = mapGet(map, -1);
    const e = mapGet(map, -2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) {
      throw new Error('Unsupported RSA WebAuthn public key.');
    }
    return {
      alg,
      jwk: {
        kty: 'RSA',
        n: base64urlEncode(n),
        e: base64urlEncode(e)
      }
    };
  }
  throw new Error(`Unsupported WebAuthn COSE key algorithm: ${alg}.`);
}

function verifySignature({ alg, publicKeyJwk, signature, signedData }) {
  const key = crypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' });
  const algorithm = alg === -7 ? 'sha256' : 'RSA-SHA256';
  return crypto.verify(algorithm, signedData, key, signature);
}

async function storeChallenge({ userId = '', email = '', type, rpId, origin }) {
  const challenge = base64urlEncode(crypto.randomBytes(32));
  await getUserPersistoStore().create('webauthnChallenge', {
    userId,
    email,
    challenge,
    type,
    rpId,
    origin,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    consumedAt: ''
  });
  return challenge;
}

async function consumeChallenge({ challenge, type }) {
  const records = await getUserPersistoStore().select('webauthnChallenge', { challenge, type }, { limit: 20 });
  const active = records
    .filter((record) => !record.consumedAt)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  if (!active) throw new Error('WebAuthn challenge not found.');
  if (new Date(active.expiresAt).getTime() < Date.now()) {
    throw new Error('WebAuthn challenge expired.');
  }
  await getUserPersistoStore().update('webauthnChallenge', active.id, { consumedAt: new Date().toISOString() });
  return active;
}

export async function startPasskeyRegistration(input = {}) {
  let user = input.userId ? await findUserById(input.userId) : null;
  if (!user && input.email) {
    user = await findUserByEmail(input.email).catch(() => null);
  }
  if (!user) throw new Error('A userId or email is required for passkey registration.');

  const rpId = normalizeRpId(input);
  const browserRpId = publicRpId(rpId);
  const origin = normalizeOrigin(input);
  const challenge = await storeChallenge({ userId: user.id, email: user.email, type: 'registration', rpId, origin });
  const rp = { name: input.rpName || DEFAULT_RP_NAME };
  if (browserRpId) rp.id = browserRpId;
  return {
    ok: true,
    publicKey: {
      challenge,
      rp,
      user: {
        id: base64urlEncode(Buffer.from(user.id)),
        name: user.email,
        displayName: user.displayName || user.email
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      timeout: 300000,
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      }
    }
  };
}

export async function verifyPasskeyRegistration(input = {}) {
  const credential = input.credential || (input.id && input.response ? input : input.response) || input;
  const response = credential.response || {};
  const { clientData, clientDataBuffer } = requireClientData(
    response,
    'webauthn.create',
    undefined,
    undefined
  );
  const challengeRecord = await consumeChallenge({ challenge: clientData.challenge, type: 'registration' });
  requireClientData(response, 'webauthn.create', challengeRecord.challenge, challengeRecord.origin);

  const attestation = decodeCbor(base64urlDecode(response.attestationObject));
  const authData = parseAuthenticatorData(mapGet(attestation, 'authData'));
  assertRpIdHash(authData, challengeRecord.rpId);
  if (!(authData.flags & 0x01)) throw new Error('WebAuthn user presence was not verified.');
  if (!authData.credential) throw new Error('WebAuthn attested credential data is missing.');

  const { alg, jwk } = coseToJwk(authData.credential.cosePublicKey);
  const credentialId = base64urlEncode(authData.credential.credentialId);
  const existing = await getUserPersistoStore().selectOne('passkeyCredential', { credentialId });
  if (existing) {
    if (existing.userId === challengeRecord.userId) {
      return {
        ok: true,
        credential: {
          id: existing.id,
          userId: existing.userId,
          credentialId: existing.credentialId,
          counter: existing.counter
        }
      };
    }
    throw new Error('Passkey credential is already registered.');
  }

  const saved = await getUserPersistoStore().create('passkeyCredential', {
    userId: challengeRecord.userId,
    credentialId,
    publicKey: JSON.stringify(jwk),
    alg,
    counter: authData.counter
  });
  await getUserPersistoStore().appendAudit('auth.passkey.register', {
    actorUserId: challengeRecord.userId,
    targetType: 'user',
    targetId: challengeRecord.userId,
    metadata: { credentialId, clientType: clientData.type, clientDataHash: base64urlEncode(crypto.createHash('sha256').update(clientDataBuffer).digest()) }
  });
  return { ok: true, credential: { id: saved.id, userId: saved.userId, credentialId: saved.credentialId, counter: saved.counter } };
}

export async function startPasskeyLogin(input = {}) {
  const rpId = normalizeRpId(input);
  const browserRpId = publicRpId(rpId);
  const origin = normalizeOrigin(input);
  let user = null;
  let allowCredentials = [];
  if (input.email) {
    user = await findUserByEmail(input.email);
    const credentials = await getUserPersistoStore().select('passkeyCredential', { userId: user.id }, { limit: 100 });
    allowCredentials = credentials.map((item) => ({ type: 'public-key', id: item.credentialId }));
  }
  const challenge = await storeChallenge({ userId: user?.id || '', email: user?.email || '', type: 'login', rpId, origin });
  const publicKey = {
    challenge,
    timeout: 300000,
    userVerification: 'preferred',
    allowCredentials
  };
  if (browserRpId) publicKey.rpId = browserRpId;
  return {
    ok: true,
    publicKey
  };
}

export async function verifyPasskeyLogin(input = {}) {
  const credential = input.credential || (input.id && input.response ? input : input.response) || input;
  const response = credential.response || {};
  const { clientDataBuffer } = requireClientData(response, 'webauthn.get', undefined, undefined);
  const clientData = JSON.parse(clientDataBuffer.toString('utf8'));
  const challengeRecord = await consumeChallenge({ challenge: clientData.challenge, type: 'login' });
  requireClientData(response, 'webauthn.get', challengeRecord.challenge, challengeRecord.origin);

  const credentialId = credential.id || credential.rawId;
  const stored = await getUserPersistoStore().selectOne('passkeyCredential', { credentialId });
  if (!stored) throw new Error('Passkey credential is not registered.');
  if (challengeRecord.userId && stored.userId !== challengeRecord.userId) {
    throw new Error('Passkey credential does not belong to the requested user.');
  }
  const authDataBuffer = base64urlDecode(response.authenticatorData);
  const authData = parseAuthenticatorData(authDataBuffer);
  assertRpIdHash(authData, challengeRecord.rpId);
  if (!(authData.flags & 0x01)) throw new Error('WebAuthn user presence was not verified.');
  if (Number(stored.counter || 0) > 0 && authData.counter <= Number(stored.counter || 0)) {
    throw new Error('WebAuthn authenticator counter did not advance.');
  }
  const clientHash = crypto.createHash('sha256').update(clientDataBuffer).digest();
  const signedData = Buffer.concat([authDataBuffer, clientHash]);
  const valid = verifySignature({
    alg: Number(stored.alg),
    publicKeyJwk: JSON.parse(stored.publicKey),
    signature: base64urlDecode(response.signature),
    signedData
  });
  if (!valid) throw new Error('Invalid WebAuthn signature.');
  await getUserPersistoStore().update('passkeyCredential', stored.id, { counter: authData.counter });
  const session = await getUserPersistoStore().create('session', {
    userId: stored.userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: ''
  });
  await getUserPersistoStore().appendAudit('auth.passkey.login', {
    actorUserId: stored.userId,
    targetType: 'user',
    targetId: stored.userId,
    metadata: { credentialId }
  });
  return { ok: true, user: await findUserById(stored.userId), session };
}
