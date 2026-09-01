import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-service-errors-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser, updateUser } = await import('../lib/users.mjs');
const { updateAuthPolicy } = await import('../lib/policy.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');
const { startService } = await import('../service/index.mjs');

let server;
let baseUrl;

before(async () => {
    await ensureSeedData();
    const blocked = await createUser({
        email: 'blocked@example.test',
        password: 'blocked-password',
        roles: ['user'],
    });
    await updateUser(blocked.id, { status: 'blocked' });
    await updateAuthPolicy({
        enabledAuthMethods: ['password', 'emailCode', 'passkey', 'totp'],
    });
    server = startService(0);
    if (!server.listening) await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server?.listening) {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await resetStoreForTests();
});

async function post(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
}

test('public authentication failures do not reveal sensitive internal reasons', async () => {
    const failures = await Promise.all([
        post('/service/auth/password/login', { email: 'missing@example.test', password: 'wrong-password' }),
        post('/service/auth/password/login', { email: 'blocked@example.test', password: 'blocked-password' }),
        post('/service/auth/email-code/verify', { challengeId: 'missing', code: '000000' }),
        post('/service/auth/passkey/options', { email: 'missing@example.test', origin: baseUrl }),
        post('/service/auth/totp/verify', { email: 'missing@example.test', token: '000000' }),
    ]);

    for (const failure of failures) {
        assert.equal(failure.status, 401);
        assert.deepEqual(failure.body, { ok: false, error: 'authentication_failed' });
    }
});
