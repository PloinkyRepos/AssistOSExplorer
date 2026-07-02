import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PERSISTENCE_FOLDER = mkdtempSync(join(tmpdir(), 'userpersisto-credits-'));
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser } = await import('../lib/users.mjs');
const credits = await import('../lib/credits.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

test('grant -> reserve -> commit/release cycle with immutable ledger', async () => {
    await ensureSeedData();
    const user = await createUser({ email: 'cr@x.com', displayName: 'CR', roles: ['user'] });

    await credits.grant({ userId: user.id, amount: 100, reason: 'welcome', actorId: 'system' });
    assert.deepEqual(await credits.getBalance(user.id), { balance: 100, reservedBalance: 0 });

    await credits.reserve({ userId: user.id, amount: 30, reason: 'job-1', referenceId: 'job-1' });
    assert.deepEqual(await credits.getBalance(user.id), { balance: 70, reservedBalance: 30 });

    await credits.commit({ userId: user.id, amount: 20, referenceId: 'job-1' });
    await credits.release({ userId: user.id, amount: 10, referenceId: 'job-1' });
    assert.deepEqual(await credits.getBalance(user.id), { balance: 80, reservedBalance: 0 });

    await credits.refund({ userId: user.id, amount: 5, reason: 'goodwill', referenceId: 'job-1', actorId: 'admin-1' });
    const { balance } = await credits.getBalance(user.id);
    assert.equal(balance, 85);

    const { entries, totalCount } = await credits.ledger({ userId: user.id });
    assert.equal(totalCount, 5);
    const derivedBalance = entries.reduce((acc, tx) => {
        if (['grant', 'purchase', 'refund', 'release'].includes(tx.type)) return acc + tx.amount;
        if (tx.type === 'reserve') return acc - tx.amount;
        return acc;
    }, 0);
    const derivedReserved = entries.reduce((acc, tx) => {
        if (tx.type === 'reserve') return acc + tx.amount;
        if (tx.type === 'spend' || tx.type === 'release') return acc - tx.amount;
        return acc;
    }, 0);
    assert.deepEqual({ balance: derivedBalance, reservedBalance: derivedReserved }, await credits.getBalance(user.id));
    assert.ok(entries.every((tx) => tx.createdAt && tx.txId));
});

test('overdraw and over-commit are rejected', async () => {
    const user = await createUser({ email: 'cr2@x.com', displayName: 'CR2', roles: ['user'] });
    await credits.grant({ userId: user.id, amount: 10, reason: 'seed', actorId: 'system' });
    await assert.rejects(() => credits.reserve({ userId: user.id, amount: 11, reason: 'x', referenceId: 'r' }), /insufficient/i);
    await credits.reserve({ userId: user.id, amount: 10, reason: 'x', referenceId: 'r' });
    await assert.rejects(() => credits.commit({ userId: user.id, amount: 11, referenceId: 'r' }), /insufficient/i);
});
