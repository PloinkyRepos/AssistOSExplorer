import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createRouterSigner } from './helpers/router-fixture.mjs';
import { ensureSeedData } from '../lib/bootstrap.mjs';
import { createUser, getUserById, updateUser } from '../lib/users.mjs';
import { getStore, resetStoreForTests } from '../lib/store.mjs';
import { generateToken } from '../lib/auth/totp.mjs';
import { startService } from '../service/index.mjs';

let folder, server, base, sign, member, other, blocked;
const ORIGIN = 'https://account.example.test';
const PROFILE = '/service/dashboard/api/profile';

before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'userpersisto-dashboard-'));
    process.env.PERSISTENCE_FOLDER = folder;
    process.env.USERPERSISTO_SETTINGS_KEY = 'test-dashboard-settings';
    process.env.USERPERSISTO_AUTH_METHODS = 'password,passkey,totp';
    process.env.USERPERSISTO_ALLOWED_REDIRECT_ORIGINS = ORIGIN;
    sign = await createRouterSigner();
    await ensureSeedData();
    member = await createUser({ email: 'restricted@example.test', password: 'test-password', roles: ['selfRegistered'] });
    other = await createUser({ email: 'other@example.test', roles: ['user'] });
    blocked = await createUser({ email: 'blocked@example.test', roles: ['user'] });
    await updateUser(blocked.id, { status: 'blocked' }, { actorId: 'test' });
    server = startService({ port: 0, host: '127.0.0.1' });
    if (!server.listening) await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await resetStoreForTests();
    if (folder) await rm(folder, { recursive: true, force: true });
});

async function request(path = PROFILE, { method = 'GET', body, rawBody, userId = member.id, headers = {}, claims, carrierUserId } = {}) {
    const raw = rawBody ?? (method === 'POST' ? JSON.stringify(body ?? {}) : '');
    const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...sign({ method, path, rawBody: raw, userId, origin: ORIGIN, claims, carrierUserId }), ...headers },
        ...(method === 'POST' ? { body: raw } : {}),
    });
    const data = await response.json();
    return { response, data };
}

test('restricted accounts get their own sanitized profile and cannot change another account or roles', async () => {
    const { response, data } = await request();
    assert.equal(response.status, 200);
    assert.equal(data.profile.user.id, member.id);
    assert.deepEqual(data.profile.roles, ['selfRegistered']);
    assert.equal(data.profile.capabilities.includes('explorer.access'), false);
    assert.deepEqual(data.profile.credits, { balance: 0, reservedBalance: 0 });
    assert.equal(data.profile.subscription, null);
    assert.deepEqual(data.profile.authMethods, [{ type: 'password', name: 'Password' }]);
    assert.deepEqual(data.profile.enrollments, { passkey: { configured: false, count: 0 }, totp: { configured: false, pending: false } });
    assert.deepEqual(data.profile.allowedAuthMethods, ['password', 'passkey', 'totp']);
    assert.doesNotMatch(JSON.stringify(data), /passwordHash|loginAttempts|lastLoginAttempt|credential|codeHash/);

    const changed = await request(PROFILE, { method: 'POST', body: {
        userId: other.id, actorUserId: other.id, roles: ['admin'], status: 'blocked', email: other.email,
        username: 'account-owner', displayName: 'Account owner',
    } });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.data.profile.user.id, member.id);
    assert.equal(changed.data.profile.user.displayName, 'Account owner');
    assert.equal(changed.data.profile.user.email, member.email);
    assert.deepEqual(changed.data.profile.roles, ['selfRegistered']);
    assert.equal((await getUserById(other.id)).displayName, other.displayName);

    const spoofedCarrier = await request(PROFILE, { carrierUserId: other.id });
    assert.equal(spoofedCarrier.data.profile.user.id, member.id, 'unsigned carrier fields must not override the signed subject');
});

test('dashboard requires a valid signed request and a currently active user', async () => {
    for (const path of [PROFILE, '/service/dashboard/', '/service/dashboard/main.js']) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 401);
    }
    for (const userId of ['nonexistent-user', blocked.id]) {
        assert.equal((await request(PROFILE, { userId })).response.status, 401);
        assert.equal((await request('/service/dashboard/api/auth/totp/start', { method: 'POST', userId })).response.status, 401);
    }
    assert.equal((await request(PROFILE, { headers: { 'x-ploinky-auth-info': JSON.stringify({ user: { id: member.id } }) } })).response.status, 401);
    assert.equal((await request(PROFILE, { claims: { actor: { kind: 'guest', id: `user:${member.id}` } } })).response.status, 401);
    assert.equal((await request(PROFILE, { claims: { sub: `user:${other.id}` } })).response.status, 401);
    assert.equal((await request(PROFILE, { claims: { aud: 'agent:another-service' } })).response.status, 401);
});

test('dashboard rejects replay and changes to the signed method, path, query, or body', async () => {
    const headers = sign({ path: PROFILE, userId: member.id });
    assert.equal((await fetch(`${base}${PROFILE}`, { headers })).status, 200);
    assert.equal((await fetch(`${base}${PROFILE}`, { headers })).status, 401);
    const queryHeaders = sign({ path: `${PROFILE}?view=one`, userId: member.id });
    assert.equal((await fetch(`${base}${PROFILE}?view=two`, { headers: queryHeaders })).status, 401);
    const pathHeaders = sign({ path: '/service/dashboard/api/other', userId: member.id });
    assert.equal((await fetch(`${base}${PROFILE}`, { headers: pathHeaders })).status, 401);
    const changedBody = await request(PROFILE, { method: 'POST', body: { displayName: 'tampered' }, headers:
        sign({ path: PROFILE, method: 'POST', rawBody: '{}', userId: member.id }),
    });
    assert.equal(changedBody.response.status, 401);
    assert.equal((await getUserById(member.id)).displayName, 'Account owner');
});

test('dashboard mutations require same-origin JSON, bounded objects, and an explicit endpoint', async () => {
    for (const origin of ['', 'null', 'https://other.example.test', `${ORIGIN}/`, `${ORIGIN}, https://other.example.test`]) {
        assert.equal((await request(PROFILE, { method: 'POST', headers: { origin } })).response.status, 403);
    }
    for (const headers of [
        { 'x-forwarded-host': 'account.example.test/path' },
        { 'x-forwarded-host': 'user@account.example.test' },
        { 'x-forwarded-proto': 'https,http' },
    ]) {
        assert.equal((await request(PROFILE, { method: 'POST', headers })).response.status, 403);
    }
    assert.equal((await request(PROFILE, { method: 'POST', headers: { 'content-type': 'text/plain' } })).response.status, 415);
    for (const rawBody of ['null', '[]', '"name"', '{broken']) {
        assert.equal((await request(PROFILE, { method: 'POST', rawBody })).response.status, 400);
    }
    assert.equal((await request(PROFILE, { method: 'POST', body: { displayName: {} } })).response.status, 400);
    assert.equal((await request(PROFILE, { method: 'POST', body: { displayName: 'x'.repeat(65536) } })).response.status, 413);
    assert.equal((await request('/service/dashboard/api/tool', { method: 'POST', body: { name: 'userpersisto_user_create' } })).response.status, 404);
    assert.equal((await request('/service/dashboard/api/auth/totp/start')).response.status, 404);
    assert.equal((await getUserById(member.id)).displayName, 'Account owner');
});

test('TOTP enrollment stays bound to the account and exposes only safe configured/pending state', async () => {
    const started = await request('/service/dashboard/api/auth/totp/start', { method: 'POST', body: { userId: other.id } });
    assert.equal(started.response.status, 200);
    assert.ok(started.data.secret);
    assert.match(started.data.otpauthUrl, /^otpauth:\/\/totp\//);
    const pending = await request();
    assert.deepEqual(pending.data.profile.enrollments.totp, { configured: false, pending: true });
    assert.doesNotMatch(JSON.stringify(pending.data), /secretEncrypted|codeHash|otpauthUrl/);
    assert.equal(JSON.stringify(pending.data).includes(started.data.secret), false);
    const wrong = await request('/service/dashboard/api/auth/totp/verify', { method: 'POST', body: { token: 'invalid' } });
    assert.equal(wrong.response.status, 400);
    assert.equal(wrong.data.reason, 'invalid_token');
    const confirmed = await request('/service/dashboard/api/auth/totp/verify', {
        method: 'POST', body: { userId: other.id, token: generateToken(started.data.secret) },
    });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.data.ok, true);
    const profile = (await request()).data.profile;
    assert.deepEqual(profile.enrollments.totp, { configured: true, pending: false });
    assert.equal(profile.authMethods.some((method) => method.type === 'totp'), true);
    assert.deepEqual((await request(PROFILE, { userId: other.id })).data.profile.enrollments.totp, { configured: false, pending: false });
    const repeated = await request('/service/dashboard/api/auth/totp/verify', { method: 'POST', body: { token: generateToken(started.data.secret) } });
    assert.equal(repeated.data.reason, 'setup_not_found');
});

// Minimal real WebAuthn registration fixture: CBOR none attestation with a P-256 public key.
function cbor(value) {
    const head = (major, length) => length < 24 ? Buffer.from([(major << 5) | length])
        : length < 256 ? Buffer.from([(major << 5) | 24, length])
            : Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
    if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
    if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
    if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

test('passkey enrollment preserves its challenge and pins account and browser origin', async () => {
    const started = await request('/service/dashboard/api/auth/passkey/options', {
        method: 'POST', body: { userId: other.id, origin: 'https://evil.test', rpId: 'evil.test' },
    });
    assert.equal(started.response.status, 200);
    const { challengeKey, publicKey } = started.data;
    assert.ok(challengeKey);
    assert.equal(publicKey.rp.id, 'account.example.test');
    assert.equal(Buffer.from(publicKey.user.id, 'base64url').toString(), member.id);
    const { publicKey: key } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = key.export({ format: 'jwk' });
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const credentialId = randomBytes(24);
    const authData = Buffer.concat([
        createHash('sha256').update(publicKey.rp.id).digest(), Buffer.from([0x41]),
        Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, cose,
    ]);
    const attestation = {
        id: credentialId.toString('base64url'), rawId: credentialId.toString('base64url'), type: 'public-key',
        response: {
            clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: publicKey.challenge, origin: ORIGIN })).toString('base64url'),
            attestationObject: cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])).toString('base64url'),
            transports: ['internal'],
        },
    };
    const foreign = await request('/service/dashboard/api/auth/passkey/verify', { method: 'POST', userId: other.id, body: { attestation, challengeKey } });
    assert.ok(foreign.response.status >= 400);
    const verified = await request('/service/dashboard/api/auth/passkey/verify', {
        method: 'POST', body: { attestation, challengeKey, userId: other.id, origin: 'https://evil.test' },
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.data.ok, true);
    const profile = (await request()).data.profile;
    assert.deepEqual(profile.enrollments.passkey, { configured: true, count: 1 });
    assert.equal(profile.authMethods.some((method) => method.type === 'passkey'), true);
    assert.doesNotMatch(JSON.stringify(profile), /credentialId|publicKeyJwk|clientDataHash/);
    assert.equal((await request(PROFILE, { userId: other.id })).data.profile.enrollments.passkey.count, 0);
    const replay = await request('/service/dashboard/api/auth/passkey/verify', { method: 'POST', body: { attestation, challengeKey } });
    assert.ok(replay.response.status >= 400);
    const store = await getStore();
    assert.equal((await store.getAuthMethodsObjectsByUserId(member.id)).filter((method) => method.type === 'passkey').length, 1);
});

test('policy changes disable enrollment immediately without losing configured-state information', async () => {
    process.env.USERPERSISTO_AUTH_METHODS = 'password';
    try {
        const profile = (await request()).data.profile;
        assert.deepEqual(profile.allowedAuthMethods, ['password']);
        assert.equal(profile.enrollments.totp.configured, true);
        assert.equal(profile.enrollments.passkey.configured, true);
        for (const endpoint of ['auth/totp/start', 'auth/totp/verify', 'auth/passkey/options', 'auth/passkey/verify']) {
            const result = await request(`/service/dashboard/api/${endpoint}`, { method: 'POST' });
            assert.equal(result.response.status, 404);
            assert.equal(result.data.error, 'auth_method_disabled');
        }
    } finally {
        process.env.USERPERSISTO_AUTH_METHODS = 'password,passkey,totp';
    }
});
