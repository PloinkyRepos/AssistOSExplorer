import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-code-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';
process.env.USERPERSISTO_AUTH_METHODS = 'password,emailCode';

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

test('email code does not self-register unknown users', async () => {
    const { challengeId, code, user } = await startEmailCode({ email: 'new@x.com', purpose: 'login', correlationId: 'corr-2' });
    assert.equal(code, null);
    assert.equal(user, null);
    const result = await verifyEmailCode({ challengeId, code: '000000' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'challenge_not_found');
    assert.equal(await getStore().then((store) => store.hasUser('new@x.com')), false);
});

test('concurrent verification consumes an email code exactly once', async () => {
    await createUser({ email: 'concurrent-code@x.com', roles: ['user'] });
    const { challengeId, code } = await startEmailCode({ email: 'concurrent-code@x.com', purpose: 'login' });
    const outcomes = await Promise.all([
        verifyEmailCode({ challengeId, code }),
        verifyEmailCode({ challengeId, code }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.reason === 'challenge_not_found').length, 1);
});
