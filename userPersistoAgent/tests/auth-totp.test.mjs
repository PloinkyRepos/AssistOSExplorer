import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-totp-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser } = await import('../lib/users.mjs');
const totp = await import('../lib/auth/totp.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('totp setup, verify, and login round-trip', async () => {
    await ensureSeedData();
    const user = await createUser({ email: 't@x.com', displayName: 'T', roles: ['user'] });
    const setup = await totp.setupStart({ userId: user.id });
    assert.ok(setup.secret);
    assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);

    const confirmed = await totp.setupVerify({ userId: user.id, token: totp.generateToken(setup.secret) });
    assert.equal(confirmed.ok, true);

    const login = await totp.loginVerify({ email: 't@x.com', token: totp.generateToken(setup.secret) });
    assert.equal(login.ok, true);
    assert.equal(login.user.id, user.id);

    const bad = await totp.loginVerify({ email: 't@x.com', token: '000000' });
    assert.equal(bad.ok, false);
});
