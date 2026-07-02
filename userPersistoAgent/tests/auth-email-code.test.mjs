import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-code-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser } = await import('../lib/users.mjs');
const { startEmailCode, verifyEmailCode } = await import('../lib/auth/email-code.mjs');
const { getStore, resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('email code round-trip is hashed, single-use, and expiring', async () => {
    await ensureSeedData();
    await createUser({ email: 'c@x.com', displayName: 'C', roles: ['user'] });
    const { challengeId, code } = await startEmailCode({ email: 'c@x.com', purpose: 'login', correlationId: 'corr-1' });
    assert.match(code, /^\d{6}$/);

    const store = await getStore();
    const challenge = await store.getAuthChallengeByChallengeId(challengeId);
    assert.notEqual(challenge.codeHash, code);

    const bad = await verifyEmailCode({ challengeId, code: '000000' });
    assert.equal(bad.ok, false);

    const good = await verifyEmailCode({ challengeId, code });
    assert.equal(good.ok, true);
    assert.equal(good.user.email, 'c@x.com');

    const replay = await verifyEmailCode({ challengeId, code });
    assert.equal(replay.ok, false);
});

test('self-registration path creates a selfRegistered user on verify', async () => {
    const { challengeId, code } = await startEmailCode({ email: 'new@x.com', purpose: 'login', correlationId: 'corr-2', createSelfRegistered: true });
    const result = await verifyEmailCode({ challengeId, code });
    assert.equal(result.ok, true);
    assert.equal(result.user.source, 'self-registration');
});
