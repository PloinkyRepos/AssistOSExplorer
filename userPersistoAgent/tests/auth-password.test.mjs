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

test('password is the default strategy in development', () => {
    assert.equal(getDefaultAuthMethod(), 'password');
    assert.ok(getEnabledAuthMethods().includes('emailCode'));
});
