import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-passkey-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';
process.env.USERPERSISTO_AUTH_METHODS = 'password,passkey';
process.env.USERPERSISTO_ALLOWED_REDIRECT_ORIGINS = 'https://example.test';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser } = await import('../lib/users.mjs');
const passkey = await import('../lib/auth/passkey.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('passkey options pin an allow-listed origin and matching relying-party id', async () => {
    await ensureSeedData();
    const user = await createUser({ email: 'passkey@x.com', roles: ['user'] });
    const result = await passkey.registrationOptions({
        userId: user.id,
        origin: 'https://example.test',
        rpId: 'example.test',
    });
    assert.equal(result.ok, true);
    assert.equal(result.publicKey.rp.id, 'example.test');

    await assert.rejects(
        () => passkey.registrationOptions({ userId: user.id, origin: 'https://evil.test', rpId: 'evil.test' }),
        (error) => error?.code === 'browser_origin_not_allowed'
    );
    await assert.rejects(
        () => passkey.registrationOptions({ userId: user.id, origin: 'https://example.test', rpId: 'other.test' }),
        (error) => error?.code === 'invalid_webauthn_rp_id'
    );
});
