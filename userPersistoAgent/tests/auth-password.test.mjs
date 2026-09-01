import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-pass-'));
process.env.USERPERSISTO_DEV_BOOTSTRAP = 'true';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser } = await import('../lib/users.mjs');
const { loginWithPassword, setPassword } = await import('../lib/auth/password.mjs');
const { getEnabledAuthMethods, getDefaultAuthMethod } = await import('../lib/auth/methods.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('password login verifies scrypt hash and enforces lockout', async () => {
    await ensureSeedData();
    const user = await createUser({ email: 'p@x.com', displayName: 'P', roles: ['user'], password: 'hunter22' });

    const ok = await loginWithPassword('p@x.com', 'hunter22');
    assert.equal(ok.ok, true);
    assert.equal(ok.user.id, user.id);

    for (let i = 0; i < 5; i++) {
        const bad = await loginWithPassword('p@x.com', 'wrong');
        assert.equal(bad.ok, false);
    }
    const locked = await loginWithPassword('p@x.com', 'hunter22');
    assert.equal(locked.ok, false);
    assert.equal(locked.reason, 'account_locked');
});

test('setPassword replaces the credential', async () => {
    const user = await createUser({ email: 'p2@x.com', displayName: 'P2', roles: ['user'], password: 'first-pass' });
    await setPassword({ userId: user.id, newPassword: 'second-pass', actorId: user.id });
    assert.equal((await loginWithPassword('p2@x.com', 'first-pass')).ok, false);
    assert.equal((await loginWithPassword('p2@x.com', 'second-pass')).ok, true);
});

test('concurrent bad password attempts cannot bypass the lockout counter', async () => {
    await createUser({ email: 'parallel@x.com', roles: ['user'], password: 'parallel-pass' });
    const attempts = await Promise.all(
        Array.from({ length: 5 }, () => loginWithPassword('parallel@x.com', 'wrong-password'))
    );
    assert.ok(attempts.every((attempt) => attempt.ok === false));
    assert.equal((await loginWithPassword('parallel@x.com', 'parallel-pass')).reason, 'account_locked');
});

test('password is the only default strategy', async () => {
    assert.equal(await getDefaultAuthMethod(), 'password');
    assert.deepEqual(await getEnabledAuthMethods(), ['password']);
});
