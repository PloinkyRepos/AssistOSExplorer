import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'userpersisto-billing-'));
process.env.PERSISTENCE_FOLDER = join(dir, 'persisto');
process.env.USERPERSISTO_SETTINGS_KEY = 'test-settings-key';
process.env.USERPERSISTO_SETTINGS_FILE = join(dir, 'settings.enc.json');

const { ensureSeedData } = await import('../lib/bootstrap.mjs');
const { createUser } = await import('../lib/users.mjs');
const { saveSettings } = await import('../lib/settings.mjs');
const billing = await import('../lib/billing.mjs');
const credits = await import('../lib/credits.mjs');
const { resetStoreForTests } = await import('../lib/store.mjs');

after(async () => {
    await resetStoreForTests();
});

function sign(rawBody, secret) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return `t=${t},v1=${v1}`;
}

function signWithTimestamp(rawBody, secret, timestamp) {
    const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},v1=${v1}`;
}

test('webhook applies credits exactly once (idempotent by stripeEventId)', async () => {
    await ensureSeedData();
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_test', USERPERSISTO_CREDITS_PER_UNIT: '10' });
    const user = await createUser({ email: 'pay@x.com', displayName: 'Pay', roles: ['user'] });

    const event = {
        id: 'evt_001',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_001', client_reference_id: user.id, metadata: { kind: 'credits', units: '3' } } }
    };
    const rawBody = JSON.stringify(event);
    const signatureHeader = sign(rawBody, 'whsec_test');

    const first = await billing.processStripeWebhook({ rawBody, signatureHeader });
    assert.equal(first.processed, true);
    assert.equal(first.duplicate, false);
    assert.equal((await credits.getBalance(user.id)).balance, 30);

    const second = await billing.processStripeWebhook({ rawBody, signatureHeader });
    assert.equal(second.duplicate, true);
    assert.equal((await credits.getBalance(user.id)).balance, 30);
});

test('webhook rejects a bad signature', async () => {
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const rawBody = JSON.stringify({ id: 'evt_002', type: 'checkout.session.completed', data: { object: {} } });
    await assert.rejects(() => billing.processStripeWebhook({ rawBody, signatureHeader: sign(rawBody, 'wrong-secret') }), /signature/i);
});

test('signature verification rejects a non-numeric timestamp', () => {
    const rawBody = JSON.stringify({ id: 'evt_bad_t' });
    assert.equal(billing.verifyStripeSignature(rawBody, signWithTimestamp(rawBody, 'whsec_test', 'not-a-number'), 'whsec_test'), false);
});

test('subscription events upsert subscription state', async () => {
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const user = await createUser({ email: 'sub@x.com', displayName: 'Sub', roles: ['user'] });
    const event = {
        id: 'evt_003',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_001', status: 'active', metadata: { userId: user.id }, items: { data: [{ price: { id: 'price_sub' } }] }, current_period_end: 1893456000 } }
    };
    const rawBody = JSON.stringify(event);
    await billing.processStripeWebhook({ rawBody, signatureHeader: sign(rawBody, 'whsec_test') });
    const sub = await billing.getSubscription(user.id);
    assert.equal(sub.status, 'active');
    assert.equal(sub.provider, 'stripe');
});
