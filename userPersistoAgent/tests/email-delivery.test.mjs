import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-mail-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';
process.env.USERPERSISTO_DEV_BOOTSTRAP = 'true';
process.env.PLOINKY_ROUTER_PORT = '1';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser } = await import('../lib/users.mjs');
const { startEmailCode } = await import('../lib/auth/email-code.mjs');
const { getStore, resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('email-code start records a redacted delivery log even when delivery falls back', async () => {
    await ensureSeedData();
    await createUser({ email: 'd@x.com', displayName: 'D', roles: ['user'] });
    const { challengeId } = await startEmailCode({ email: 'd@x.com', purpose: 'login', correlationId: 'corr-d' });
    assert.ok(challengeId);

    const store = await getStore();
    const logs = await store.select('emailLog', { correlationId: 'corr-d' }, {});
    assert.equal(logs.objects.length, 1);
    assert.equal(logs.objects[0].result, 'dev-console');
    assert.notEqual(logs.objects[0].toEmailHash, 'd@x.com');
});
