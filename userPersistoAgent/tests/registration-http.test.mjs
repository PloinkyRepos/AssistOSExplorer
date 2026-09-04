import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ensureSeedData } from '../lib/bootstrap.mjs';
import { getSetupStatus, getUserByEmail } from '../lib/users.mjs';
import { createLoginRequest, consumeAuthCode } from '../lib/sso.mjs';
import { resetStoreForTests } from '../lib/store.mjs';
import { startService } from '../service/index.mjs';

test('HTTP registration rejects invalid passwords before claiming first owner, and permits a corrected retry', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'userpersisto-register-http-'));
    process.env.PERSISTENCE_FOLDER = folder;
    process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';
    let server;
    try {
        await ensureSeedData();
        server = startService({ port: 0, host: '127.0.0.1' });
        if (!server.listening) await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const request = await createLoginRequest({ redirectUri: `${base}/auth/callback` });
        const post = (password) => fetch(`${base}/service/auth/register`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'owner@example.test', password, requestId: request.providerState }),
        });
        for (const password of [undefined, '', null, false, 0, {}, [], 'short', 'x'.repeat(1025)]) {
            const response = await post(password);
            assert.equal(response.status, 400);
            assert.equal((await response.json()).error, 'invalid_password');
            assert.equal(await getUserByEmail('owner@example.test'), null);
            assert.equal((await getSetupStatus()).needsInitialAdmin, true);
        }
        const response = await post('valid-owner-password');
        assert.equal(response.status, 201);
        const body = await response.json();
        assert.equal(body.firstUser, true);
        assert.deepEqual((await consumeAuthCode({ providerState: request.providerState, code: body.code })).roles, ['admin']);
        const loginRequest = await createLoginRequest({ redirectUri: `${base}/auth/callback` });
        const login = await fetch(`${base}/service/auth/password/login`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'owner@example.test', password: 'valid-owner-password', requestId: loginRequest.providerState }),
        });
        assert.equal(login.status, 200);
    } finally {
        if (server?.listening) await new Promise((resolve) => server.close(resolve));
        await resetStoreForTests();
        await rm(folder, { recursive: true, force: true });
    }
});

test('registration and credential login against an unknown or expired login request are client errors and create nothing', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'userpersisto-dead-request-'));
    process.env.PERSISTENCE_FOLDER = folder;
    process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';
    let server;
    try {
        await ensureSeedData();
        server = startService({ port: 0, host: '127.0.0.1' });
        if (!server.listening) await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const live = await createLoginRequest({ redirectUri: `${base}/auth/callback` });
        const owner = await fetch(`${base}/service/auth/register`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'owner@example.test', password: 'valid-owner-password', requestId: live.providerState }),
        });
        assert.equal(owner.status, 201);
        const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        for (const requestId of ['not-a-live-request', live.providerState, '']) {
            const registration = await post('/service/auth/register', { email: 'ghost@example.test', password: 'valid-ghost-password', requestId });
            assert.equal(registration.status, 400, `dead request ${JSON.stringify(requestId)} is a client error`);
            assert.equal((await registration.json()).error, 'login_request_invalid');
            assert.equal(await getUserByEmail('ghost@example.test'), null, 'no account is created for a dead request');
            const login = await post('/service/auth/password/login', { email: 'owner@example.test', password: 'valid-owner-password', requestId });
            assert.equal(login.status, 400);
            assert.equal((await login.json()).error, 'login_request_invalid');
        }
        const expiring = await createLoginRequest({ redirectUri: `${base}/auth/callback` });
        const { getStore } = await import('../lib/store.mjs');
        const store = await getStore();
        const record = await store.getSsoLoginRequestByProviderState(expiring.providerState);
        await store.updateSsoLoginRequest(record.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
        const expired = await post('/service/auth/password/login', { email: 'owner@example.test', password: 'valid-owner-password', requestId: expiring.providerState });
        assert.equal(expired.status, 400);
        assert.equal((await expired.json()).error, 'login_request_expired');
        assert.equal((await getSetupStatus()).userCount, 1);
    } finally {
        if (server?.listening) await new Promise((resolve) => server.close(resolve));
        await resetStoreForTests();
        await rm(folder, { recursive: true, force: true });
    }
});
