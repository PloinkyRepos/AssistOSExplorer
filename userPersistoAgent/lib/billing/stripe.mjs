import crypto from 'node:crypto';
import { getUserPersistoStore } from '../storage/persisto-store.mjs';
import { getRawSetting } from '../settings.mjs';
import { purchaseCredits } from '../credits/ledger.mjs';

async function getStripeSecretKey() {
  return await getRawSetting('STRIPE_SECRET_KEY') || process.env.STRIPE_SECRET_KEY || '';
}

async function getStripeWebhookSecret() {
  return await getRawSetting('STRIPE_WEBHOOK_SECRET') || process.env.STRIPE_WEBHOOK_SECRET || '';
}

function parseStripeSignature(signature = '') {
  const parts = {};
  for (const segment of String(signature || '').split(',')) {
    const [key, value] = segment.split('=');
    if (!key || !value) continue;
    parts[key] ||= [];
    parts[key].push(value);
  }
  return parts;
}

function verifyStripeWebhookSignature(rawBody, signature, secret) {
  if (!secret) throw new Error('Stripe webhook secret is not configured.');
  const parsed = parseStripeSignature(signature);
  const timestamp = parsed.t?.[0] || '';
  const signatures = parsed.v1 || [];
  if (!timestamp || !signatures.length) throw new Error('Invalid Stripe webhook signature header.');
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const valid = signatures.some((candidate) => {
    const actualBuffer = Buffer.from(candidate);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  });
  if (!valid) throw new Error('Invalid Stripe webhook signature.');
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (ageSeconds > 300) throw new Error('Stripe webhook signature timestamp is outside tolerance.');
}

export async function getSubscription(input = {}) {
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const subscription = await getUserPersistoStore().selectOne('subscription', { userId });
  return { userId, subscription: subscription || null };
}

export async function createStripeCheckout(input = {}) {
  const secretKey = await getStripeSecretKey();
  if (!secretKey) {
    throw new Error('Stripe secret key is not configured.');
  }
  const userId = String(input.userId || '').trim();
  if (!userId) throw new Error('userId is required.');
  const mode = input.mode === 'subscription' ? 'subscription' : 'payment';
  const priceKey = mode === 'subscription' ? 'STRIPE_PRICE_SUBSCRIPTION' : 'STRIPE_PRICE_CREDITS';
  const price = await getRawSetting(priceKey) || process.env[priceKey] || '';
  if (!price) throw new Error(`${priceKey} is not configured.`);

  const body = new URLSearchParams();
  body.set('mode', mode);
  body.set('success_url', String(input.successUrl || ''));
  body.set('cancel_url', String(input.cancelUrl || ''));
  body.set('line_items[0][price]', price);
  body.set('line_items[0][quantity]', '1');
  body.set('metadata[userId]', userId);
  body.set('metadata[mode]', mode);
  if (Number.isFinite(input.creditsAmount)) {
    body.set('metadata[creditsAmount]', String(Math.max(0, Math.floor(input.creditsAmount))));
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe checkout failed with ${response.status}.`);
  }
  await getUserPersistoStore().appendAudit('billing.stripe.checkout.create', {
    targetType: 'user',
    targetId: userId,
    metadata: { mode, sessionId: payload.id }
  });
  return { ok: true, checkout: payload };
}

async function recordBillingEvent(event, status = 'received', metadata = {}) {
  const store = getUserPersistoStore();
  const providerEventId = String(event.id || '').trim();
  if (!providerEventId) throw new Error('Stripe event id is required.');
  const existing = await store.selectOne('billingEvent', { providerEventId });
  if (existing) return { event: existing, created: false };
  const object = event.data?.object || {};
  const userId = String(object.metadata?.userId || '').trim();
  const record = await store.create('billingEvent', {
    provider: 'stripe',
    providerEventId,
    type: String(event.type || ''),
    status,
    userId,
    metadata,
    receivedAt: new Date().toISOString(),
    processedAt: ''
  });
  return { event: record, created: true };
}

async function processCheckoutCompleted(event) {
  const session = event.data?.object || {};
  const userId = String(session.metadata?.userId || '').trim();
  if (!userId) throw new Error('Stripe checkout session is missing metadata.userId.');
  const mode = String(session.mode || session.metadata?.mode || '').trim();
  if (mode === 'subscription') {
    const store = getUserPersistoStore();
    const existing = await store.selectOne('subscription', { userId });
    const payload = {
      userId,
      provider: 'stripe',
      providerCustomerId: String(session.customer || ''),
      providerSubscriptionId: String(session.subscription || ''),
      status: 'active',
      currentPeriodEnd: ''
    };
    if (existing?.id) {
      await store.update('subscription', existing.id, payload);
    } else {
      await store.create('subscription', payload);
    }
    return { action: 'subscription_upserted', userId };
  }
  const creditsAmount = Number(session.metadata?.creditsAmount || 0);
  if (creditsAmount > 0) {
    const result = await purchaseCredits({
      userId,
      amount: creditsAmount,
      reason: 'stripe_checkout',
      reference: String(session.id || event.id || '')
    });
    return { action: 'credits_purchased', userId, amount: creditsAmount, balance: result.balance };
  }
  return { action: 'checkout_recorded', userId };
}

async function applyBillingEvent(event) {
  if (event.type === 'checkout.session.completed') {
    return processCheckoutCompleted(event);
  }
  return { action: 'ignored', type: event.type };
}

export async function handleStripeWebhook({ rawBody = '', signature = '' } = {}) {
  const secret = await getStripeWebhookSecret();
  verifyStripeWebhookSignature(rawBody, signature, secret);
  const event = JSON.parse(rawBody);
  const { event: billingEvent, created } = await recordBillingEvent(event, 'received', { stripeType: event.type });
  if (!created && billingEvent.status === 'processed') {
    return { ok: true, duplicate: true, billingEvent };
  }
  const result = await applyBillingEvent(event);
  const updated = await getUserPersistoStore().update('billingEvent', billingEvent.id, {
    status: 'processed',
    processedAt: new Date().toISOString(),
    metadata: { ...(billingEvent.metadata || {}), result }
  });
  await getUserPersistoStore().appendAudit('billing.stripe.webhook.processed', {
    targetType: 'billingEvent',
    targetId: updated.id,
    metadata: { providerEventId: event.id, type: event.type, result }
  });
  return { ok: true, duplicate: false, billingEvent: updated, result };
}
