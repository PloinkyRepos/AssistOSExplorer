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
const { getStore, flush, resetStoreForTests } = await import('../lib/store.mjs');

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

async function seedCreditCheckout({ sessionId, userId, credits, amountMinor = 0, currency = '' }) {
    const timestamp = new Date().toISOString();
    await (await getStore()).createPaymentTransaction({
        providerKey: `stripe:checkout:${sessionId}`,
        provider: 'stripe',
        providerEventId: '',
        providerObjectId: sessionId,
        userId,
        kind: 'credits',
        status: 'checkout_created',
        amountMinor,
        currency,
        credits,
        createdAt: timestamp,
        updatedAt: timestamp,
    });
    await flush();
}

test('webhook applies credits exactly once (idempotent by stripeEventId)', async () => {
    await ensureSeedData();
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_test', USERPERSISTO_CREDITS_PER_UNIT: '10' });
    const user = await createUser({ email: 'pay@x.com', displayName: 'Pay', roles: ['user'] });
    await seedCreditCheckout({ sessionId: 'cs_001', userId: user.id, credits: 30 });
    await saveSettings({ USERPERSISTO_CREDITS_PER_UNIT: '100' });

    const event = {
        id: 'evt_001',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_001', payment_status: 'paid', client_reference_id: user.id, metadata: { kind: 'credits', units: '3' } } }
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

test('checkout identity conflicts fail before credits are applied', async () => {
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const owner = await createUser({ email: 'payment-owner@x.com', roles: ['user'] });
    const other = await createUser({ email: 'payment-other@x.com', roles: ['user'] });
    await seedCreditCheckout({ sessionId: 'cs_bound_owner', userId: owner.id, credits: 25 });
    const event = {
        id: 'evt_wrong_payment_owner',
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_bound_owner',
                payment_status: 'paid',
                client_reference_id: other.id,
                metadata: { kind: 'credits', units: '1', userId: other.id },
            },
        },
    };
    const rawBody = JSON.stringify(event);
    await assert.rejects(
        () => billing.processStripeWebhook({ rawBody, signatureHeader: sign(rawBody, 'whsec_test') }),
        (error) => error?.code === 'payment_identity_conflict'
    );
    assert.equal((await credits.getBalance(owner.id)).balance, 0);
    assert.equal((await credits.getBalance(other.id)).balance, 0);
});

test('paid credit checkout requires a locally initiated transaction', async () => {
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const user = await createUser({ email: 'missing-checkout@x.com', roles: ['user'] });
    const event = {
        id: 'evt_missing_checkout',
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_not_local',
                payment_status: 'paid',
                client_reference_id: user.id,
                metadata: { kind: 'credits', units: '1', userId: user.id },
            },
        },
    };
    const rawBody = JSON.stringify(event);
    await assert.rejects(
        () => billing.processStripeWebhook({ rawBody, signatureHeader: sign(rawBody, 'whsec_test') }),
        (error) => error?.code === 'payment_transaction_not_found'
    );
    assert.equal((await credits.getBalance(user.id)).balance, 0);
});

test('unpaid checkout completion does not grant credits', async () => {
    const user = await createUser({ email: 'unpaid@x.com', displayName: 'Unpaid', roles: ['user'] });
    const event = {
        id: 'evt_unpaid',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_unpaid', payment_status: 'unpaid', client_reference_id: user.id, metadata: { kind: 'credits', units: '50' } } }
    };
    const rawBody = JSON.stringify(event);
    const outcome = await billing.processStripeWebhook({ rawBody, signatureHeader: sign(rawBody, 'whsec_test') });
    assert.equal(outcome.credited, false);
    assert.equal((await credits.getBalance(user.id)).balance, 0);
});

test('a processed Stripe event id cannot be reused with another payload', async () => {
    const original = JSON.stringify({ id: 'evt_payload', type: 'noop', data: { object: { value: 1 } } });
    await billing.processStripeWebhook({ rawBody: original, signatureHeader: sign(original, 'whsec_test') });
    const changed = JSON.stringify({ id: 'evt_payload', type: 'noop', data: { object: { value: 2 } } });
    await assert.rejects(
        () => billing.processStripeWebhook({ rawBody: changed, signatureHeader: sign(changed, 'whsec_test') }),
        /different payload/i
    );
});

test('event idempotency survives webhook-secret rotation', async () => {
    const rawBody = JSON.stringify({ id: 'evt_secret_rotation', type: 'noop', data: { object: {} } });
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_rotation_a' });
    await billing.processStripeWebhook({ rawBody, signatureHeader: sign(rawBody, 'whsec_rotation_a') });
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_rotation_b' });
    const duplicate = await billing.processStripeWebhook({ rawBody, signatureHeader: sign(rawBody, 'whsec_rotation_b') });
    assert.equal(duplicate.duplicate, true);
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

test('signature verification rejects fractional timestamps', () => {
    const rawBody = JSON.stringify({ id: 'evt_fractional_t' });
    const timestamp = `${Math.floor(Date.now() / 1000)}.5`;
    assert.equal(billing.verifyStripeSignature(rawBody, signWithTimestamp(rawBody, 'whsec_test', timestamp), 'whsec_test'), false);
});

test('checkout rejects invalid financial boundaries before contacting Stripe', async () => {
    await assert.rejects(
        () => billing.createCheckout({ userId: 'user-1', kind: 'credits', quantity: 0 }),
        (error) => error?.code === 'invalid_quantity'
    );
    await assert.rejects(
        () => billing.createCheckout({ userId: 'user-1', kind: 'credits', quantity: 1, idempotencyKey: 'x'.repeat(256) }),
        (error) => error?.code === 'invalid_idempotency_key'
    );
});

test('checkout rejects an unknown user before contacting Stripe', async () => {
    const originalFetch = globalThis.fetch;
    let contacted = false;
    globalThis.fetch = async () => {
        contacted = true;
        throw new Error('unexpected Stripe request');
    };
    try {
        await assert.rejects(
            () => billing.createCheckout({ userId: 'missing-user', kind: 'credits', quantity: 1 }),
            (error) => error?.code === 'user_not_found'
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(contacted, false);
});

test('checkout scopes Stripe idempotency by user and persists provider transactions', async () => {
    await saveSettings({
        STRIPE_SECRET_KEY: 'sk_test',
        STRIPE_PRICE_CREDITS: 'price_credits',
        USERPERSISTO_BILLING_SUCCESS_URL: 'https://app.example.test/billing/success',
        USERPERSISTO_BILLING_CANCEL_URL: 'https://app.example.test/billing/cancel',
    });
    const first = await createUser({ email: 'checkout-a@x.com', roles: ['user'] });
    const second = await createUser({ email: 'checkout-b@x.com', roles: ['user'] });
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        requests.push(options);
        const index = requests.length;
        return {
            ok: true,
            async json() {
                return {
                    id: `cs_scoped_${index}`,
                    url: `https://checkout.stripe.com/c/pay/scoped-${index}`,
                    amount_total: 100,
                    currency: 'usd',
                };
            },
        };
    };
    try {
        await billing.createCheckout({ userId: first.id, kind: 'credits', quantity: 1, idempotencyKey: 'same-client-key' });
        await billing.createCheckout({ userId: second.id, kind: 'credits', quantity: 1, idempotencyKey: 'same-client-key' });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.notEqual(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
    assert.equal((await billing.listPaymentTransactions({ userId: first.id })).objects.length, 1);
    assert.equal((await billing.listPaymentTransactions({ userId: second.id })).objects.length, 1);
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

test('a Stripe subscription identity cannot move between users', async () => {
    await saveSettings({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const first = await createUser({ email: 'sub-owner-a@x.com', roles: ['user'] });
    const second = await createUser({ email: 'sub-owner-b@x.com', roles: ['user'] });
    const firstEvent = {
        id: 'evt_sub_owner_a',
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_bound', status: 'active', metadata: { userId: first.id } } },
    };
    const firstBody = JSON.stringify(firstEvent);
    await billing.processStripeWebhook({ rawBody: firstBody, signatureHeader: sign(firstBody, 'whsec_test') });

    const movedEvent = {
        id: 'evt_sub_owner_b',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_bound', status: 'active', metadata: { userId: second.id } } },
    };
    const movedBody = JSON.stringify(movedEvent);
    await assert.rejects(
        () => billing.processStripeWebhook({ rawBody: movedBody, signatureHeader: sign(movedBody, 'whsec_test') }),
        (error) => error?.code === 'subscription_identity_conflict'
    );
});
