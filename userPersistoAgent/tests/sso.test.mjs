import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-sso-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser, updateUser } = await import('../lib/users.mjs');
const sso = await import('../lib/sso.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('sso auth code round-trip returns user with roles and capabilities', async () => {
    await ensureSeedData();
    const user = await createUser({ email: 's@x.com', displayName: 'S', roles: ['admin'], password: 'pw-123456' });

    const request = await sso.createLoginRequest({ redirectUri: 'http://localhost:8080/auth/callback', clientId: 'explorer' });
    assert.ok(request.providerState);

    const issued = await sso.issueAuthCode({ providerState: request.providerState, userId: user.id });
    assert.ok(issued.code);
    assert.equal(issued.redirectUri, 'http://localhost:8080/auth/callback');

    const consumed = await sso.consumeAuthCode({ providerState: request.providerState, code: issued.code });
    assert.equal(consumed.user.email, 's@x.com');
    assert.ok(consumed.roles.includes('admin'));
    assert.ok(consumed.capabilities.includes('explorer.access'));

    await assert.rejects(() => sso.consumeAuthCode({ providerState: request.providerState, code: issued.code }));
});

test('getSsoUser rejects blocked users', async () => {
    const user = await createUser({ email: 'b@x.com', displayName: 'B', roles: ['user'] });
    await updateUser(user.id, { status: 'blocked' });
    await assert.rejects(() => sso.getSsoUser(user.id));
});

test('a login request can issue only one auth code under concurrency', async () => {
    const user = await createUser({ email: 'single-code@x.com', roles: ['user'] });
    const request = await sso.createLoginRequest({ redirectUri: 'http://localhost:8080/auth/callback', clientId: 'explorer' });
    const outcomes = await Promise.allSettled([
        sso.issueAuthCode({ providerState: request.providerState, userId: user.id }),
        sso.issueAuthCode({ providerState: request.providerState, userId: user.id }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
});

test('an invalid login request cannot run registration side effects', async () => {
    let called = false;
    await assert.rejects(
        () => sso.issueAuthCode({
            providerState: 'not-a-login-request',
            resolveUserId: async () => {
                called = true;
                return 'should-not-be-used';
            },
        }),
        /unknown or expired/i
    );
    assert.equal(called, false);
});
